//! 冷 · Conditional requests for the JSON API.
//!
//! The two reads every page makes are the whole payload: on a seeded
//! library `/api/user/volume` is a megabyte of JSON and
//! `/api/user/library` eighty kilobytes, sent in full on every cold
//! load, every reload, every returning tab. They were sent with no
//! validator and no caching directive at all, so the browser could
//! never ask "still the same?" — it could only ask again.
//!
//! This middleware gives every JSON `GET` under `/api` a weak `ETag`
//! over the exact bytes it is about to send, and answers `304 Not
//! Modified` when the client offers a matching `If-None-Match`. The
//! directive is `private, no-cache`: store it, but never use it without
//! asking first. That is deliberate for one account's data — a
//! revalidation costs a round trip and about 200 bytes, and a reader
//! who changes account, or whose session is revoked, can never be shown
//! a cached row that is no longer theirs.
//!
//! What it saves is the wire, not the work: the server still runs the
//! query and serialises the answer in order to hash it. Skipping that
//! needs a per-row version to build the validator from, which the
//! realtime layer already tracks and a later change can use.
//!
//! The tag is **weak** because `CompressionLayer` sits outside this one
//! and the body a client receives may be gzip or brotli where the one
//! hashed here is neither. A weak validator is exactly the licence to
//! say "same content, possibly different bytes", and `If-None-Match`
//! compares weakly in any case.

use axum::body::{Body, to_bytes};
use axum::extract::Request;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use http_body::Body as HttpBody;
use sha2::{Digest, Sha256};

/// Above this, a response is streamed straight through untagged.
/// Buffering it to hash it would cost more memory than the tag saves,
/// and the archive bundle — the only thing near it — is downloaded
/// once, not revalidated.
const MAX_TAGGED_BODY: u64 = 8 * 1024 * 1024;

pub async fn etag_middleware(req: Request, next: Next) -> Response {
    let is_get = req.method() == Method::GET;
    let if_none_match = req
        .headers()
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);

    let res = next.run(req).await;

    // A body whose length is not known in advance is a stream: buffering
    // it here would hold the response open until the stream ended.
    let sized = res.body().size_hint().upper();
    if !is_get || !taggable(res.status(), res.headers(), sized) {
        return res;
    }

    let (mut parts, body) = res.into_parts();
    let bytes = match to_bytes(body, MAX_TAGGED_BODY as usize).await {
        Ok(bytes) => bytes,
        // The body failed mid-collection; it is gone either way.
        Err(err) => {
            tracing::warn!(%err, "could not read response body to tag it");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    let etag = weak_etag(&bytes);
    if let Ok(value) = HeaderValue::from_str(&etag) {
        parts.headers.insert(header::ETAG, value);
    }
    // Only when the handler did not say. `/api/public-config` serves the
    // same answer to everyone and asks for `public, max-age=60`;
    // stamping `private, no-cache` over it would have turned a cached
    // config into a round trip on every page.
    parts
        .headers
        .entry(header::CACHE_CONTROL)
        .or_insert_with(|| HeaderValue::from_static("private, no-cache"));

    if if_none_match
        .as_deref()
        .is_some_and(|offered| etag_matches(offered, &etag))
    {
        parts.status = StatusCode::NOT_MODIFIED;
        // A 304 carries no body, so it must not describe one.
        parts.headers.remove(header::CONTENT_LENGTH);
        parts.headers.remove(header::CONTENT_TYPE);
        return Response::from_parts(parts, Body::empty());
    }

    Response::from_parts(parts, Body::from(bytes))
}

/// Is this response one we may hash and tag?
fn taggable(status: StatusCode, headers: &HeaderMap, size_upper: Option<u64>) -> bool {
    if status != StatusCode::OK {
        return false;
    }
    // A handler that computed its own validator knows better than we do.
    if headers.contains_key(header::ETAG) {
        return false;
    }
    let is_json = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("application/json"));
    if !is_json {
        return false;
    }
    size_upper.is_some_and(|n| n <= MAX_TAGGED_BODY)
}

/// A weak validator over the bytes as this server produced them.
fn weak_etag(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let hex: String = digest[..16].iter().map(|b| format!("{b:02x}")).collect();
    format!("W/\"{hex}\"")
}

/// Weak comparison, per RFC 9110 § 8.8.3.2: `W/` is not part of the
/// tag, and `If-None-Match` may carry a list or the wildcard.
fn etag_matches(if_none_match: &str, etag: &str) -> bool {
    let opaque = |raw: &str| {
        raw.trim()
            .trim_start_matches("W/")
            .trim_matches('"')
            .to_owned()
    };
    if if_none_match.trim() == "*" {
        return true;
    }
    let ours = opaque(etag);
    if_none_match
        .split(',')
        .any(|offered| opaque(offered) == ours)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(
                header::HeaderName::from_bytes(name.as_bytes()).unwrap(),
                HeaderValue::from_str(value).unwrap(),
            );
        }
        map
    }

    const JSON: &[(&str, &str)] = &[("content-type", "application/json")];

    #[test]
    fn tags_a_sized_json_two_hundred_and_nothing_else() {
        assert!(taggable(StatusCode::OK, &headers(JSON), Some(1024)));
        // Not a 200: an error body has no identity worth caching.
        assert!(!taggable(StatusCode::NOT_FOUND, &headers(JSON), Some(1024)));
        // Not JSON: a poster or a CSV export.
        assert!(!taggable(
            StatusCode::OK,
            &headers(&[("content-type", "image/webp")]),
            Some(1024)
        ));
        // A stream. Buffering it would hold the response open.
        assert!(!taggable(StatusCode::OK, &headers(JSON), None));
        // Bigger than we are willing to hold in memory.
        assert!(!taggable(
            StatusCode::OK,
            &headers(JSON),
            Some(MAX_TAGGED_BODY + 1)
        ));
        assert!(taggable(
            StatusCode::OK,
            &headers(JSON),
            Some(MAX_TAGGED_BODY)
        ));
        // A handler with its own validator keeps it.
        assert!(!taggable(
            StatusCode::OK,
            &headers(&[("content-type", "application/json"), ("etag", "\"abc\"")]),
            Some(1024)
        ));
    }

    #[test]
    fn a_handlers_own_caching_directive_wins() {
        // `HeaderMap::entry(..).or_insert_with(..)` is what the
        // middleware leans on; this pins the behaviour it relies on.
        let mut map = headers(&[("cache-control", "public, max-age=60")]);
        map.entry(header::CACHE_CONTROL)
            .or_insert_with(|| HeaderValue::from_static("private, no-cache"));
        assert_eq!(map[header::CACHE_CONTROL], "public, max-age=60");

        let mut bare = HeaderMap::new();
        bare.entry(header::CACHE_CONTROL)
            .or_insert_with(|| HeaderValue::from_static("private, no-cache"));
        assert_eq!(bare[header::CACHE_CONTROL], "private, no-cache");
    }

    #[test]
    fn the_tag_follows_the_bytes() {
        let a = weak_etag(br#"[{"mal_id":1}]"#);
        let b = weak_etag(br#"[{"mal_id":2}]"#);
        assert_ne!(a, b);
        assert_eq!(a, weak_etag(br#"[{"mal_id":1}]"#));
        assert!(a.starts_with("W/\"") && a.ends_with('"'));
        // 16 bytes of digest, hex: W/" + 32 + "
        assert_eq!(a.len(), 3 + 32 + 1);
    }

    #[test]
    fn matching_ignores_weakness_and_reads_a_list() {
        let ours = weak_etag(b"body");
        let bare = ours.trim_start_matches("W/").to_owned();
        assert!(etag_matches(&ours, &ours));
        // A client that dropped the W/ prefix still matches: the
        // comparison is on the opaque tag, as it must be.
        assert!(etag_matches(&bare, &ours));
        assert!(etag_matches("*", &ours));
        assert!(etag_matches(
            &format!("W/\"deadbeef\", {ours}, \"cafe\""),
            &ours
        ));
        assert!(!etag_matches("W/\"deadbeef\"", &ours));
        assert!(!etag_matches("", &ours));
        assert!(!etag_matches(&weak_etag(b"other"), &ours));
    }
}
