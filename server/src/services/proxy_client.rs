//! 仲介 · Client for the manga-release-proxy sidecar service.
//!
//! When `EXTERNAL_PROXY_URL` is set on the server, the upcoming-volume
//! cascade fans every per-publisher / per-API source call out to this
//! proxy instead of running them in-process. The proxy returns one
//! aggregated payload per series — the server merges that with its
//! in-process Google Books results.
//!
//! ## Failure mode
//!
//! Best-effort. If the proxy is down, slow, or returns malformed
//! data, this client logs and returns an empty `Vec`. The cascade
//! then carries only its Google Books hits (still useful) — the
//! calendar UI degrades gracefully rather than 500-ing the user
//! request.
//!
//! ## TLS / hostname
//!
//! Operators are expected to deploy the proxy on a reachable
//! intranet hostname (Docker Compose service name, k8s Service DNS
//! name, etc.). The reqwest `Client` reused here picks up the same
//! rustls trust roots as every other outbound caller.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// One row in the proxy's aggregated response. Mirrors the proxy's
/// `UpcomingRelease` shape exactly — when this struct drifts the
/// proxy's Cargo.toml major version should bump too.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProxyRelease {
    pub source: String,
    pub series_title: String,
    pub vol_num: i32,
    pub release_date: DateTime<Utc>,
    pub isbn: Option<String>,
    pub url: Option<String>,
    pub locale: Option<String>,
}

/// Top-level proxy response. We only need `releases` on the server
/// side; `key` and `titles` are kept on the wire for clients that
/// hit the proxy directly.
#[derive(Clone, Debug, Deserialize)]
struct ProxyResponse {
    #[serde(default)]
    releases: Vec<ProxyRelease>,
}

/// Fetch upcoming volumes from the proxy. `proxy_url` is the base URL
/// (without trailing `/`); we append `/v1/upcoming` and the query
/// params here.
///
/// Returns `Vec::new()` on any failure: missing url, network error,
/// non-200, malformed JSON. Errors are logged at DEBUG (the cascade
/// already runs Google Books in parallel, so a proxy hiccup isn't a
/// hard failure for the user request).
pub async fn fetch_upcoming(
    client: &reqwest::Client,
    proxy_url: &str,
    mal_id: Option<i32>,
    mangadex_id: Option<&str>,
    locales: &[&str],
    timeout: std::time::Duration,
) -> Vec<ProxyRelease> {
    if mal_id.is_none() && mangadex_id.map(str::is_empty).unwrap_or(true) {
        return Vec::new();
    }

    let base = proxy_url.trim_end_matches('/');
    let mut url = format!("{base}/v1/upcoming?");
    let mut first = true;
    let mut push_param = |k: &str, v: &str| {
        if !first {
            url.push('&');
        }
        url.push_str(k);
        url.push('=');
        // urlencoding for safety — locales contain commas, mangadex
        // ids are UUIDs (safe) but we still encode defensively.
        url.push_str(&urlencoded(v));
        first = false;
    };
    if let Some(id) = mal_id {
        push_param("mal_id", &id.to_string());
    }
    if let Some(id) = mangadex_id {
        if !id.is_empty() {
            push_param("mangadex_id", id);
        }
    }
    if !locales.is_empty() {
        push_param("locales", &locales.join(","));
    }

    let response = match client.get(&url).timeout(timeout).send().await {
        Ok(r) => r,
        Err(err) => {
            tracing::debug!(%err, url, "proxy: request failed");
            return Vec::new();
        }
    };
    if !response.status().is_success() {
        tracing::debug!(status = %response.status(), url, "proxy: non-200");
        return Vec::new();
    }
    match response.json::<ProxyResponse>().await {
        Ok(body) => body.releases,
        Err(err) => {
            tracing::debug!(%err, url, "proxy: parse failed");
            Vec::new()
        }
    }
}

/// Minimal URL encoder — every byte that isn't an unreserved char per
/// RFC 3986 gets percent-escaped. Pulling in the `urlencoding` crate
/// for one call site felt heavy; this routine handles the alphabet
/// the cascade actually generates (ASCII digits, hyphens, commas,
/// the `mal_id` digits and `mangadex_id` UUIDs).
fn urlencoded(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.bytes() {
        let safe = b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~');
        if safe {
            out.push(b as char);
        } else {
            out.push('%');
            out.push_str(&format!("{:02X}", b));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urlencoded_passes_unreserved() {
        assert_eq!(urlencoded("abc-DEF_123.~"), "abc-DEF_123.~");
    }

    #[test]
    fn urlencoded_escapes_separators() {
        assert_eq!(urlencoded("fr,en"), "fr%2Cen");
        assert_eq!(urlencoded("a b"), "a%20b");
    }

    #[tokio::test]
    async fn fetch_returns_empty_when_no_ids() {
        let client = reqwest::Client::new();
        let out = fetch_upcoming(
            &client,
            "http://localhost:1",
            None,
            None,
            &["fr"],
            std::time::Duration::from_secs(1),
        )
        .await;
        assert!(out.is_empty());
    }
}
