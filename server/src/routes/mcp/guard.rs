//! What stands between the network and a tool call: the operator's
//! kill-switch, the per-key rate limiter, and API-key authentication.
//!
//! Order matters, and `super::router` wires it: the switch is checked
//! first (a disabled feature should cost a config read and nothing
//! else), then the limiter — which keys on the raw header, so it can
//! shed a flood of bad credentials without resolving any of them — and
//! only then authentication.

use axum::{
    body::Body,
    extract::{Request, State},
    http::{StatusCode, header},
    middleware::Next,
    response::Response,
};
use tower_governor::key_extractor::KeyExtractor;

use crate::services::api_keys;
use crate::state::AppState;

/// Where the RFC 9728 metadata document lives, relative to the public
/// origin.
pub const RESOURCE_METADATA_PATH: &str = "/.well-known/oauth-protected-resource";

fn json_response(status: StatusCode, body: &'static str) -> Response {
    let mut res = Response::new(Body::from(body));
    *res.status_mut() = status;
    res.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/json"),
    );
    res
}

/// A 401 that tells the client *how* to authenticate.
///
/// The specification has a protected server answer with
/// `WWW-Authenticate` so a client can discover the scheme instead of
/// showing a bare "unauthorized". We advertise `Bearer` and point at our
/// metadata document — which deliberately lists no
/// `authorization_servers`, so a client can tell that a statically
/// issued key is what is wanted and stop looking for an OAuth flow that
/// does not exist here.
fn unauthorized(origin: &str) -> Response {
    let origin = origin.trim_end_matches('/');
    let challenge = format!(
        "Bearer realm=\"MangaCollector\", error=\"invalid_token\", \
         error_description=\"a MangaCollector API key is required\", \
         resource_metadata=\"{origin}{RESOURCE_METADATA_PATH}\""
    );
    let mut res = json_response(
        StatusCode::UNAUTHORIZED,
        r#"{"error":"unauthorized","message":"a MangaCollector API key is required"}"#,
    );
    if let Ok(value) = header::HeaderValue::from_str(&challenge) {
        res.headers_mut().insert(header::WWW_AUTHENTICATE, value);
    }
    res
}

/// Refuse everything while the operator has the endpoint switched off.
///
/// `403 feature_disabled` rather than `404`: the endpoint's existence is
/// public — it is documented and the settings page links to it — so
/// hiding it would only make a misconfiguration harder to diagnose.
pub async fn require_enabled(State(state): State<AppState>, req: Request, next: Next) -> Response {
    if state.config.mcp.enabled {
        next.run(req).await
    } else {
        json_response(
            StatusCode::FORBIDDEN,
            r#"{"error":"feature_disabled","message":"the MCP endpoint is disabled on this instance (set MCP_ENABLED=true)"}"#,
        )
    }
}

/// The credential as presented, from either header.
///
/// `Authorization: Bearer` is what the specification requires; `X-Api-Key`
/// is a fallback for the handful of clients that cannot set an
/// `Authorization` header. Note the specification also forbids putting
/// the token in the query string, which is why neither is read from
/// there — a URL ends up in logs, proxies and history.
fn presented(headers: &header::HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        // RFC 6750 §2.1 makes the scheme case-insensitive, and clients
        // in the field do send `bearer`. Matching only `Bearer ` turned
        // those into an unexplained 401 against a key that was fine.
        .and_then(|v| {
            let (scheme, rest) = v.split_once(' ')?;
            scheme.eq_ignore_ascii_case("bearer").then_some(rest)
        })
        .or_else(|| headers.get("x-api-key").and_then(|v| v.to_str().ok()))
        .map(str::trim)
}

/// Resolve the API key and hand the principal down to the tool handlers.
///
/// rmcp copies the surviving `http::request::Parts` into the MCP
/// request's extensions, so what is inserted here is what `ctx::call`
/// reads back out.
pub async fn authenticate(State(state): State<AppState>, mut req: Request, next: Next) -> Response {
    let Some(token) = presented(req.headers()) else {
        return unauthorized(&state.config.frontend_url);
    };
    let principal = match api_keys::authenticate(&state.db, token).await {
        Ok(p) => p,
        Err(crate::errors::AppError::Unauthorized) => {
            return unauthorized(&state.config.frontend_url);
        }
        // A database failure is ours, not the caller's — don't dress it
        // as a bad credential and send them off rotating keys.
        Err(e) => return axum::response::IntoResponse::into_response(e),
    };
    tracing::debug!(
        user_id = %principal.user.id,
        key_id = %principal.key_id,
        scopes = ?principal.scopes.to_strings(),
        "authenticated an MCP request"
    );
    req.extensions_mut().insert(principal);
    next.run(req).await
}

/// Rate-limit bucket key: the *public* prefix of the presented key.
///
/// The IP-based extractor the rest of the app uses is wrong here — a
/// household or a CGNAT carrier would share one bucket, and a single
/// agent's retry loop would throttle everyone behind it. Keying on the
/// prefix gives each credential its own budget.
///
/// Only the prefix is used, never the secret: bucket keys live in memory
/// and are the sort of thing that ends up in a debug dump.
#[derive(Clone)]
pub struct ApiKeyBucket;

impl KeyExtractor for ApiKeyBucket {
    type Key = String;

    fn extract<B>(
        &self,
        req: &axum::http::Request<B>,
    ) -> Result<Self::Key, tower_governor::GovernorError> {
        // `mcp_<prefix>_<secret>` → `mcp_<prefix>`. Anything unparseable,
        // a missing header included, shares one "anonymous" bucket —
        // which is exactly where credential-probing traffic belongs.
        Ok(presented(req.headers())
            .and_then(|token| token.strip_prefix(api_keys::TOKEN_MARKER))
            .and_then(|rest| rest.split('_').next())
            .filter(|prefix| !prefix.is_empty())
            .map(|prefix| format!("{}{prefix}", api_keys::TOKEN_MARKER))
            .unwrap_or_else(|| "anonymous".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;

    fn req(headers: &[(&str, &str)]) -> Request<()> {
        let mut b = Request::builder();
        for (k, v) in headers {
            b = b.header(*k, *v);
        }
        b.body(()).unwrap()
    }

    #[test]
    fn the_bearer_header_wins_and_x_api_key_is_the_fallback() {
        let r = req(&[("authorization", "Bearer mcp_abc_def")]);
        assert_eq!(presented(r.headers()), Some("mcp_abc_def"));
        let r = req(&[("x-api-key", "mcp_ghi_jkl")]);
        assert_eq!(presented(r.headers()), Some("mcp_ghi_jkl"));
        let r = req(&[
            ("authorization", "Bearer mcp_abc_def"),
            ("x-api-key", "mcp_ghi_jkl"),
        ]);
        assert_eq!(presented(r.headers()), Some("mcp_abc_def"));
        assert_eq!(presented(req(&[]).headers()), None);
    }

    #[test]
    fn the_bearer_scheme_is_case_insensitive() {
        // RFC 6750 §2.1. Clients do send `bearer`, and rejecting them
        // looked like a bad key rather than a picky server.
        for scheme in ["Bearer", "bearer", "BEARER", "BeArEr"] {
            let r = req(&[("authorization", &format!("{scheme} mcp_abc_def"))]);
            assert_eq!(
                presented(r.headers()),
                Some("mcp_abc_def"),
                "`{scheme}` should be accepted"
            );
        }
    }

    #[test]
    fn a_non_bearer_authorization_is_not_a_credential() {
        // Basic auth must not be read as a key, and must not fall
        // through to whatever `x-api-key` happens to say.
        let r = req(&[("authorization", "Basic dXNlcjpwYXNz")]);
        assert_eq!(presented(r.headers()), None);
    }

    #[test]
    fn the_bucket_is_the_public_prefix_and_never_the_secret() {
        let key = ApiKeyBucket
            .extract(&req(&[(
                "authorization",
                "Bearer mcp_0123456789ab_not-a-real-secret",
            )]))
            .unwrap();
        assert_eq!(key, "mcp_0123456789ab");
        assert!(!key.contains("not-a-real-secret"));
    }

    #[test]
    fn unparseable_credentials_share_one_bucket() {
        // Probing traffic must not get a fresh budget per guess.
        for headers in [
            vec![],
            vec![("authorization", "Bearer garbage")],
            vec![("x-api-key", "mcp_")],
            vec![("authorization", "Bearer mcp__nosecret")],
        ] {
            assert_eq!(
                ApiKeyBucket.extract(&req(&headers)).unwrap(),
                "anonymous",
                "{headers:?} should share the anonymous bucket"
            );
        }
    }

    #[test]
    fn the_challenge_points_at_the_metadata_document() {
        let res = unauthorized("https://manga.example.com/");
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        let challenge = res
            .headers()
            .get(header::WWW_AUTHENTICATE)
            .and_then(|v| v.to_str().ok())
            .expect("a 401 must say how to authenticate");
        assert!(challenge.starts_with("Bearer "));
        // One slash, not two: the origin is trimmed before joining.
        assert!(challenge.contains(&format!(
            "resource_metadata=\"https://manga.example.com{RESOURCE_METADATA_PATH}\""
        )));
    }
}
