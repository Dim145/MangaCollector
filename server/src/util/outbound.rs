//! 外 · How far the server's own requests may be sent somewhere else.
//!
//! Every URL the shared HTTP client fetches is built from a literal host
//! (Jikan, MangaDex, AniList, Google Books, Open Library, the BnF,
//! openBD, the operator's release proxy). What those hosts answer is
//! not ours: a redirect is a *second* URL nobody chose, and the client
//! used to follow two of them to any scheme and any address — the
//! operator's private network and a cloud metadata endpoint included.
//!
//! A hop is followed now only to `https`, to a named host that is not
//! local, or to a public IP address; and never more than two of them.
//! A refused hop is not an error: the redirect response itself comes
//! back, and the caller sees a status it does not treat as success.

use std::net::{Ipv4Addr, Ipv6Addr};

use reqwest::Url;
use reqwest::redirect::{Attempt, Policy};

const MAX_HOPS: usize = 2;

/// The redirect policy for the shared outbound client.
pub fn redirect_policy() -> Policy {
    Policy::custom(|attempt: Attempt| {
        if attempt.previous().len() >= MAX_HOPS || !safe_hop(attempt.url()) {
            attempt.stop()
        } else {
            attempt.follow()
        }
    })
}

/// May a redirect land here?
pub fn safe_hop(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    match url.host() {
        Some(url::Host::Domain(name)) => public_name(name),
        Some(url::Host::Ipv4(ip)) => public_v4(ip),
        Some(url::Host::Ipv6(ip)) => public_v6(ip),
        None => false,
    }
}

fn public_name(name: &str) -> bool {
    let name = name.trim_end_matches('.').to_ascii_lowercase();
    // A single label ("intranet", "db") is resolved against the host's
    // search domains — somebody's internal network, not the internet.
    name.contains('.')
        && !name.ends_with(".localhost")
        && !name.ends_with(".local")
        && !name.ends_with(".internal")
        && !name.ends_with(".lan")
        && !name.ends_with(".home.arpa")
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || a == 0
        // 100.64.0.0/10, carrier-grade NAT — shared, not public.
        || (a == 100 && (64..=127).contains(&b)))
}

fn public_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return public_v4(v4);
    }
    let first = ip.segments()[0];
    !(ip.is_loopback()
        || ip.is_unspecified()
        // fc00::/7, unique local.
        || (first & 0xfe00) == 0xfc00
        // fe80::/10, link local.
        || (first & 0xffc0) == 0xfe80)
}

#[cfg(test)]
mod tests {
    use super::safe_hop;
    use reqwest::Url;

    fn hop(url: &str) -> bool {
        safe_hop(&Url::parse(url).unwrap())
    }

    #[test]
    fn a_move_to_another_public_https_host_is_followed() {
        assert!(hop("https://books.googleusercontent.com/x"));
        assert!(hop("https://catalogue.bnf.fr/api/SRU"));
        assert!(hop("https://93.184.216.34/"));
        assert!(hop("https://[2606:4700::1111]/"));
    }

    /// 外 · The places a redirect must never take a request from inside
    /// the operator's network.
    #[test]
    fn a_move_into_a_private_network_is_refused() {
        for refused in [
            "http://api.jikan.moe/v4/manga/1", // not TLS
            "https://localhost/admin",
            "https://127.0.0.1/",
            "https://10.0.0.5/",
            "https://192.168.1.1/",
            "https://172.16.0.1/",
            "https://169.254.169.254/latest/meta-data/", // cloud metadata
            "https://100.64.0.1/",                       // carrier NAT
            "https://0.0.0.0/",
            "https://[::1]/",
            "https://[fd00::1]/",
            "https://[fe80::1]/",
            "https://[::ffff:10.0.0.1]/",
            "https://db/", // a bare label
            "https://printer.local/",
            "https://metadata.google.internal/",
            "https://router.lan/",
            "file:///etc/passwd",
        ] {
            assert!(!hop(refused), "should refuse {refused}");
        }
    }
}
