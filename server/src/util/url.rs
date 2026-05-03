//! SSRF-safe URL builders for outbound HTTP calls.
//!
//! CodeQL's `rust/request-forgery` rule flags
//! `format!("https://api.example.com/{}/path", user_input)` even when
//! `user_input` is an `i32` whose `Display` impl can only produce
//! `[-+0-9]` (no `@`, `/`, `:`, `#` that could re-host the request).
//! The taint-flow analysis can't see through `Display`.
//!
//! Reshaping URL construction through `Url::path_segments_mut`
//! satisfies the sanitizer chain AND adds genuine defence in depth:
//! the URL builder percent-encodes path segments, so even a future
//! change to the segment type (i32 → String, etc.) can't accidentally
//! inject reserved characters that would alter the URL's authority.

use reqwest::Url;

use crate::errors::AppError;

/// Construct a URL from a static base and a sequence of path
/// segments.
///
/// `base` must be a `'static` string literal — no taint can flow
/// into the host or scheme. Each entry in `segments` is pushed via
/// `Url::path_segments_mut`, which percent-encodes reserved
/// characters and prevents a segment from re-anchoring the path
/// (e.g. a leading `/`).
///
/// Use the returned `Url` directly with `client.get(url)` —
/// `reqwest::IntoUrl` accepts both `Url` and `&str`.
pub fn build_url(base: &'static str, segments: &[&str]) -> Result<Url, AppError> {
    let mut url = Url::parse(base)
        .map_err(|e| AppError::Internal(format!("invalid base URL '{base}': {e}")))?;
    {
        let mut segs = url
            .path_segments_mut()
            .map_err(|_| AppError::Internal(format!("base URL '{base}' is cannot-be-a-base")))?;
        for s in segments {
            segs.push(s);
        }
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pushes_simple_segments() {
        let url = build_url("https://api.example.com/v4/manga", &["42", "full"]).unwrap();
        assert_eq!(url.as_str(), "https://api.example.com/v4/manga/42/full");
    }

    #[test]
    fn percent_encodes_reserved() {
        // A leading slash in a segment would otherwise re-anchor the
        // path. The builder escapes it.
        let url = build_url("https://api.example.com/v4", &["/etc/passwd"]).unwrap();
        assert!(url.as_str().contains("%2Fetc%2Fpasswd"));
        assert_eq!(url.host_str(), Some("api.example.com"));
    }

    #[test]
    fn no_host_swap_via_at_sign() {
        // `evil.com@victim.com` would re-host as `victim.com` if
        // dropped raw into the authority part of a URL. Pushed via
        // `path_segments_mut`, the segment lands inside the path —
        // `@` is a valid `pchar` per RFC 3986 so the builder may
        // keep it literal, but the authority is fixed and never
        // re-parsed. The security invariant we care about is that
        // the host doesn't swap.
        let url = build_url("https://api.example.com/v4", &["evil.com@victim.com"]).unwrap();
        assert_eq!(url.host_str(), Some("api.example.com"));
        assert_eq!(url.scheme(), "https");
    }

    #[test]
    fn no_scheme_swap_via_colon() {
        // A future segment starting with `javascript:` shouldn't
        // alter the scheme. Path segments live inside `path` and
        // never participate in scheme parsing once the URL is
        // already built.
        let url = build_url("https://api.example.com/v4", &["javascript:alert(1)"]).unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("api.example.com"));
    }

    #[test]
    fn rejects_invalid_base() {
        assert!(build_url("not a url", &["x"]).is_err());
    }
}
