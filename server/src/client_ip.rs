//! 源 · Which address a request comes from, as the rate limiters see it.
//!
//! Two deployments, two answers — `TRUST_PROXY_HEADERS` says which one
//! this is (see `config.rs` for why it cannot be detected):
//!
//! * **Directly exposed**: the socket's peer address is the client, and
//!   every forwarding header is whatever the client typed.
//! * **Behind a reverse proxy**: the peer is the proxy, and the client
//!   is the address the proxy *appended* to `X-Forwarded-For`.
//!
//! The second is where the stock `SmartIpKeyExtractor` went wrong: it
//! keys on the **leftmost** entry of `X-Forwarded-For`, and the leftmost
//! entry is the one the client wrote. A proxy that appends (nginx's
//! `$proxy_add_x_forwarded_for`, HAProxy's `forwardfor`, Cloudflare,
//! Traefik with trusted IPs configured) leaves it in place, so a random
//! value per request minted a fresh bucket per request and the limiter
//! did nothing. The address that can be trusted is the one the nearest
//! proxy wrote — the rightmost — or, with several proxies in a row, the
//! one `TRUSTED_PROXY_HOPS` places from the right.
//!
//! Both extractors also group IPv6 addresses by their /64. One host is
//! routinely handed a whole /64, so keying on the full address let a
//! single machine rotate through 2^64 buckets.

use std::net::{IpAddr, Ipv6Addr, SocketAddr};

use axum::extract::ConnectInfo;
use axum::http::{HeaderMap, Request};
use tower_governor::GovernorError;
use tower_governor::key_extractor::KeyExtractor;

/// The bucket an address is counted in: itself for IPv4, its /64 for
/// IPv6, and an IPv4 address carried in IPv6 as the IPv4 it is.
pub fn bucket_of(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V4(_) => ip,
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => IpAddr::V4(v4),
            None => {
                let prefix = u128::from(v6) & !((1u128 << 64) - 1);
                IpAddr::V6(Ipv6Addr::from(prefix))
            }
        },
    }
}

/// The client address a chain of `hops` trusted proxies vouches for:
/// the `hops`-th entry of `X-Forwarded-For`, counted from the right,
/// across every header line in order. `None` when the chain is shorter
/// than that — the request did not come through the proxies — or the
/// entry is not an address.
pub fn forwarded_client(headers: &HeaderMap, hops: usize) -> Option<IpAddr> {
    let entries: Vec<&str> = headers
        .get_all("x-forwarded-for")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .collect();
    let index = entries.len().checked_sub(hops.max(1))?;
    entries[index].parse().ok()
}

fn peer<T>(req: &Request<T>) -> Option<IpAddr> {
    req.extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ConnectInfo(addr)| addr.ip())
        .or_else(|| req.extensions().get::<SocketAddr>().map(SocketAddr::ip))
}

/// Keys on the socket's peer — for an instance nothing stands in front
/// of. Forwarding headers are ignored: here, the client wrote them.
#[derive(Debug, Clone, Copy)]
pub struct PeerKeyExtractor;

impl KeyExtractor for PeerKeyExtractor {
    type Key = IpAddr;

    fn extract<T>(&self, req: &Request<T>) -> Result<Self::Key, GovernorError> {
        peer(req)
            .map(bucket_of)
            .ok_or(GovernorError::UnableToExtractKey)
    }
}

/// Keys on the address the trusted proxy chain appended — for an
/// instance behind `hops` reverse proxies (usually one). Falls back to
/// `X-Real-IP` for a proxy that sets only that, then to the peer.
#[derive(Debug, Clone, Copy)]
pub struct TrustedProxyKeyExtractor {
    pub hops: usize,
}

impl KeyExtractor for TrustedProxyKeyExtractor {
    type Key = IpAddr;

    fn extract<T>(&self, req: &Request<T>) -> Result<Self::Key, GovernorError> {
        let headers = req.headers();
        forwarded_client(headers, self.hops)
            .or_else(|| {
                headers
                    .get("x-real-ip")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.trim().parse().ok())
            })
            .or_else(|| peer(req))
            .map(bucket_of)
            .ok_or(GovernorError::UnableToExtractKey)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn xff(lines: &[&str]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for line in lines {
            headers.append("x-forwarded-for", HeaderValue::from_str(line).unwrap());
        }
        headers
    }

    /// 源 · The client writes the left of the chain; the proxy writes the
    /// right. A forged entry must not decide the bucket.
    #[test]
    fn the_address_the_proxy_appended_is_the_one_that_counts() {
        let forged = xff(&["6.6.6.6, 203.0.113.9"]);
        assert_eq!(
            forwarded_client(&forged, 1),
            Some("203.0.113.9".parse().unwrap())
        );
        // A fresh forged value per request no longer means a fresh bucket.
        let again = xff(&["7.7.7.7, 203.0.113.9"]);
        assert_eq!(forwarded_client(&forged, 1), forwarded_client(&again, 1));
    }

    #[test]
    fn several_proxies_are_counted_from_the_right() {
        // client → CDN → Traefik → app: Traefik appended the CDN's edge.
        let chain = xff(&["6.6.6.6, 198.51.100.4, 192.0.2.10"]);
        assert_eq!(
            forwarded_client(&chain, 2),
            Some("198.51.100.4".parse().unwrap())
        );
        // Header lines are one list, in order.
        let split = xff(&["6.6.6.6", "198.51.100.4, 192.0.2.10"]);
        assert_eq!(
            forwarded_client(&split, 2),
            Some("198.51.100.4".parse().unwrap())
        );
    }

    #[test]
    fn a_chain_too_short_or_junk_vouches_for_nothing() {
        assert_eq!(forwarded_client(&xff(&["203.0.113.9"]), 2), None);
        assert_eq!(forwarded_client(&xff(&["1.1.1.1, unknown"]), 1), None);
        assert_eq!(forwarded_client(&HeaderMap::new(), 1), None);
    }

    /// One machine is routinely given a whole /64; every address in it
    /// is the same client as far as a limiter is concerned.
    #[test]
    fn ipv6_is_counted_by_its_slash_64() {
        let a: IpAddr = "2001:db8:1:2:aaaa::1".parse().unwrap();
        let b: IpAddr = "2001:db8:1:2:ffff:ffff:ffff:ffff".parse().unwrap();
        let other: IpAddr = "2001:db8:1:3::1".parse().unwrap();
        assert_eq!(bucket_of(a), bucket_of(b));
        assert_ne!(bucket_of(a), bucket_of(other));
        // IPv4 is left alone, and IPv4-in-IPv6 is the IPv4 it carries.
        let v4: IpAddr = "203.0.113.9".parse().unwrap();
        assert_eq!(bucket_of(v4), v4);
        assert_eq!(bucket_of("::ffff:203.0.113.9".parse().unwrap()), v4);
    }
}
