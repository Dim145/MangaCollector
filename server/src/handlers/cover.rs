//! 影 · The cover relay.
//!
//! Every shelf the app draws pulls its covers straight from
//! `uploads.mangadex.org` and `cdn.myanimelist.net`. The `Referer` is
//! already withheld, but the request itself is not: opening a library
//! hands both CDNs the reader's address, once per cover — 113 requests
//! and 4.5 MB on the seeded library. For an archive whose whole claim
//! is that it collects nothing, that is the last place a reader is
//! visible to someone else.
//!
//! With `PROXY_COVERS=true` the browser asks this instead, and the
//! server fetches the image. The CDNs then see the server, once per
//! cover, and nothing about who is looking.
//!
//! It is **off by default**, and deliberately so: turning it on moves
//! those megabytes onto the operator's connection. On a personal
//! instance that is nothing; on a shared one it is a decision, and the
//! person who pays for the bandwidth should be the one who makes it.
//!
//! **What it cannot do, measured.** MyAnimeList serves the relay
//! normally. MangaDex does not: `uploads.mangadex.org` answers
//! `ENHANCE_YOUR_CALM` — an HTTP/2 reset — to this server, on the
//! *first* stream of a fresh connection, at any concurrency, while the
//! same URL from a browser on the same machine returns the image. That
//! is a refusal of the client, not a rate limit to be polite around,
//! and the only ways past it are to disguise the server as a browser
//! or to fetch each cover once and keep it. The first is working
//! around somebody's access control and is not on the table; the
//! second is a server-side cover cache, with the storage cost that
//! implies, and it is the honest next step. Until then a library whose
//! covers come from MangaDex keeps fetching them directly: the browser
//! falls back to the original URL when a relayed cover fails, so
//! turning the relay on costs one refused request per MangaDex cover
//! and protects the MyAnimeList ones.
//!
//! Three guards, all of them load-bearing:
//!
//!   * the allow-list (`is_whitelisted_poster_url`) is what keeps this
//!     from being an open proxy into the operator's network — it is
//!     the same predicate the poster upload path already trusts;
//!   * a size cap, because the answer is held in memory;
//!   * a content-type check, because what comes back is served to a
//!     browser and `image/*` is the only thing that should.

use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{HeaderValue, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use std::sync::LazyLock;
use std::time::Duration;
use tokio::sync::Semaphore;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::services::cover_pool::is_whitelisted_poster_url;
use crate::state::AppState;

/// Covers run to a few hundred kilobytes; this is a ceiling, not a
/// budget. The body is buffered to send it, so it bounds memory too.
const MAX_COVER_BYTES: usize = 8 * 1024 * 1024;
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(10);

/// 礼 · How many covers this server will ask a CDN for at once.
///
/// A shelf asks for a hundred images in one breath, and funnelling
/// that into one server is not something to do to a guest. Six is
/// roughly what a browser allows itself per host. It also bounds this
/// server's own outbound work, which is why it stays even though it
/// did not fix what it was first reached for — see the note on
/// MangaDex above.
static UPSTREAM_SLOTS: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(6));

#[derive(Deserialize)]
pub struct CoverQuery {
    /// The upstream image, absolute and on an allow-listed host.
    pub src: String,
}

/// `GET /api/user/cover?src=…`
pub async fn proxy_cover(
    State(state): State<AppState>,
    AuthenticatedUser(_user): AuthenticatedUser,
    Query(query): Query<CoverQuery>,
) -> Result<Response, AppError> {
    if !state.proxy_covers {
        return Err(AppError::NotFound("Cover proxy is disabled".into()));
    }
    if !is_whitelisted_poster_url(&query.src) {
        return Err(AppError::BadRequest("Cover host not allowed".into()));
    }

    // Held until the answer is in hand, so the count is of requests in
    // flight rather than of requests started.
    let _slot = UPSTREAM_SLOTS
        .acquire()
        .await
        .map_err(|_| AppError::Internal("Cover relay is shutting down".into()))?;

    let upstream = state
        .http_client
        .get(&query.src)
        .timeout(UPSTREAM_TIMEOUT)
        .send()
        .await
        .map_err(|err| {
            // Same reasoning as the refusal below: from the shelf, a
            // relay that cannot reach the CDN is indistinguishable from
            // one that is switched off.
            tracing::warn!(err = ?err, src = %query.src, "cover proxy: upstream unreachable");
            AppError::NotFound("Cover unavailable".into())
        })?;

    if !upstream.status().is_success() {
        // Worth a line: a relay that answers nothing looks, from the
        // shelf, exactly like a relay that is switched off, and the
        // operator has no other way to tell the difference.
        tracing::warn!(
            status = %upstream.status(),
            src = %query.src,
            "cover proxy: upstream refused"
        );
        return Err(AppError::NotFound("Cover unavailable".into()));
    }

    // Trust nothing about the answer. The type decides what a browser
    // will do with these bytes, so anything but an image is refused
    // rather than forwarded.
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.starts_with("image/"))
        .map(str::to_owned)
        .ok_or_else(|| AppError::BadRequest("Upstream did not return an image".into()))?;

    if upstream
        .content_length()
        .is_some_and(|len| len as usize > MAX_COVER_BYTES)
    {
        return Err(AppError::BadRequest("Cover too large".into()));
    }

    let bytes = upstream.bytes().await.map_err(|err| {
        tracing::debug!(%err, "cover proxy: body failed mid-flight");
        AppError::NotFound("Cover unavailable".into())
    })?;
    if bytes.len() > MAX_COVER_BYTES {
        return Err(AppError::BadRequest("Cover too large".into()));
    }

    let content_type = HeaderValue::from_str(&content_type)
        .unwrap_or_else(|_| HeaderValue::from_static("image/jpeg"));

    Ok((
        [
            (header::CONTENT_TYPE, content_type),
            (
                // A cover URL names one image for good: MangaDex's are
                // content-addressed and MAL's are per-series. `private`
                // because the relay answers only a signed-in reader, so
                // a shared cache has no business keeping it.
                header::CACHE_CONTROL,
                HeaderValue::from_static("private, max-age=31536000, immutable"),
            ),
        ],
        Body::from(bytes),
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use crate::services::cover_pool::is_whitelisted_poster_url;

    /// 門 · The allow-list is the only thing between this relay and the
    /// operator's private network, so it is pinned here as well as at
    /// its definition: this handler is the caller that makes it matter.
    #[test]
    fn the_relay_only_follows_the_two_cover_hosts() {
        assert!(is_whitelisted_poster_url(
            "https://uploads.mangadex.org/covers/abc/def.jpg"
        ));
        assert!(is_whitelisted_poster_url(
            "https://cdn.myanimelist.net/images/manga/2/253146l.jpg"
        ));

        for refused in [
            "http://uploads.mangadex.org/covers/a.jpg", // not TLS
            "https://localhost/secret.png",
            "https://127.0.0.1/secret.png",
            "https://169.254.169.254/latest/meta-data/", // cloud metadata
            "https://evil.test/uploads.mangadex.org/a.jpg",
            "https://uploads.mangadex.org.evil.test/a.jpg",
            "file:///etc/passwd",
            "",
        ] {
            assert!(
                !is_whitelisted_poster_url(refused),
                "should refuse {refused}"
            );
        }
    }
}
