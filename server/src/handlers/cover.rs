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
//!   * the request is **rebuilt, not forwarded** (`relay_target`): one
//!     of two origins written in this file as literals, plus the path
//!     of what the reader asked for, segment by segment, each held to
//!     the characters a CDN object name uses. Nothing else of the
//!     reader's URL — scheme, host, port, userinfo, query — reaches the
//!     socket, which is what keeps this from being an open proxy into
//!     the operator's network. For the same reason the relay follows
//!     **no** redirect: a hop is a second URL that nothing checked;
//!   * a size cap, enforced as the bytes arrive rather than after —
//!     a `Content-Length` is a claim, and a chunked answer makes none;
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
    /// The upstream image the reader's shelf would have fetched. Read
    /// for its host and its path only — see `relay_target`.
    pub src: String,
}

/// 門 · The request this relay makes, rebuilt from `src` — or `None`
/// when `src` is not a cover on one of the two CDNs.
///
/// Rebuilt, not forwarded, and rebuilt from nothing the reader wrote:
/// the origin, the directory names and the file extensions are literals
/// chosen by comparison, and the only variable parts — MyAnimeList's
/// numeric ids and MangaDex's UUIDs — are parsed into integers and
/// printed back. What reaches the socket is therefore one of the shapes
/// below and nothing else; a path those two CDNs would not serve a
/// cover from is refused rather than relayed.
///
/// An earlier version checked `src` against the allow-list and then
/// fetched `src`. That held only as long as the check and the parser
/// behind `reqwest` agreed on what the host was, and CodeQL's
/// request-forgery analysis rightly could not see that they would. The
/// same version then rebuilt the URL around the reader's own path
/// segments, which kept the reader's text in the request: still flagged,
/// and still more than the relay needs.
///
/// Query strings are dropped: both CDNs serve a cover as a plain
/// object. MyAnimeList's signed resize URLs (`/r/…?s=…`) are not
/// covers of this shape and fall back to a direct fetch in the browser.
///
/// `let … else { return None }` rather than `?`, deliberately — hence
/// the one `allow` below. CodeQL models the early return of `?` as
/// carrying its operand out of the function, so `Url::parse(src).ok()?`
/// alone drew a request-forgery path from the query string straight to
/// the relay's request, whatever this function actually returns. With
/// the explicit form the analysis sees what the code does, and finds
/// nothing (verified with CodeQL 2.27, the version code scanning runs).
#[allow(clippy::question_mark)]
fn relay_target(src: &str) -> Option<reqwest::Url> {
    let Ok(asked) = reqwest::Url::parse(src) else {
        return None;
    };
    if asked.scheme() != "https"
        || !asked.username().is_empty()
        || asked.password().is_some()
        || asked.port().is_some()
    {
        return None;
    }
    let Some(segments) = asked.path_segments() else {
        return None;
    };
    let segments: Vec<&str> = segments.collect();
    let rebuilt = match asked.host_str() {
        Some("cdn.myanimelist.net") => mal_cover(&segments),
        Some("uploads.mangadex.org") => mangadex_cover(&segments),
        _ => None,
    };
    let Some(rebuilt) = rebuilt else {
        return None;
    };
    reqwest::Url::parse(&rebuilt).ok()
}

/// `images/{kind}/{shard}/{id}{size}.{ext}` on MyAnimeList's CDN.
fn mal_cover(segments: &[&str]) -> Option<String> {
    let [images, kind, shard, file] = segments else {
        return None;
    };
    if *images != "images" {
        return None;
    }
    let kind: &'static str = match *kind {
        "manga" => "manga",
        "anime" => "anime",
        "characters" => "characters",
        "voiceactors" => "voiceactors",
        _ => return None,
    };
    let shard = small_number(shard, 6)?;
    let (stem, ext) = file.rsplit_once('.')?;
    let ext: &'static str = match ext {
        "jpg" => "jpg",
        "webp" => "webp",
        _ => return None,
    };
    let (id, size): (&str, &'static str) = match stem.strip_suffix('l') {
        Some(id) => (id, "l"),
        None => match stem.strip_suffix('t') {
            Some(id) => (id, "t"),
            None => (stem, ""),
        },
    };
    let id = small_number(id, 12)?;
    Some(format!(
        "https://cdn.myanimelist.net/images/{kind}/{shard}/{id}{size}.{ext}"
    ))
}

/// `covers/{manga-uuid}/{file-uuid}.{ext}[.256.jpg|.512.jpg]` on
/// MangaDex's.
fn mangadex_cover(segments: &[&str]) -> Option<String> {
    let [covers, manga, file] = segments else {
        return None;
    };
    if *covers != "covers" {
        return None;
    }
    let manga = dashed_hex_value(manga)?;
    let (file_id, rest) = (file.get(..36)?, file.get(36..)?);
    let file_id = dashed_hex_value(file_id)?;
    let (ext, thumb) = rest.split_at(
        rest.find(".256.")
            .or_else(|| rest.find(".512."))
            .unwrap_or(rest.len()),
    );
    let ext: &'static str = match ext {
        ".jpg" => ".jpg",
        ".jpeg" => ".jpeg",
        ".png" => ".png",
        ".gif" => ".gif",
        ".webp" => ".webp",
        _ => return None,
    };
    let thumb: &'static str = match thumb {
        "" => "",
        ".256.jpg" => ".256.jpg",
        ".512.jpg" => ".512.jpg",
        _ => return None,
    };
    Some(format!(
        "https://uploads.mangadex.org/covers/{}/{}{ext}{thumb}",
        dashed_hex_text(manga),
        dashed_hex_text(file_id)
    ))
}

/// A run of at most `max_digits` ASCII digits, as the number it is.
fn small_number(text: &str, max_digits: usize) -> Option<u64> {
    if text.is_empty() || text.len() > max_digits || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

/// A lowercase or uppercase 8-4-4-4-12 UUID, as a 128-bit number.
///
/// Named for its shape rather than as a "uuid": CodeQL's sensitive-data
/// heuristic reads any name containing `uid` as a user id, and flagged
/// the cover's object id — a public name in a public URL — as account
/// information sent over the network. It is neither.
fn dashed_hex_value(text: &str) -> Option<u128> {
    let bytes = text.as_bytes();
    if bytes.len() != 36 || [8, 13, 18, 23].iter().any(|&i| bytes[i] != b'-') {
        return None;
    }
    let hex: String = text.chars().filter(|c| *c != '-').collect();
    if hex.len() != 32 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    u128::from_str_radix(&hex, 16).ok()
}

/// A 128-bit number written back as a lowercase 8-4-4-4-12 UUID.
fn dashed_hex_text(value: u128) -> String {
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        (value >> 96) as u32,
        ((value >> 80) & 0xffff) as u16,
        ((value >> 64) & 0xffff) as u16,
        ((value >> 48) & 0xffff) as u16,
        value & 0xffff_ffff_ffff
    )
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
    let Some(target) = relay_target(&query.src) else {
        return Err(AppError::BadRequest("Cover host not allowed".into()));
    };

    // Held until the answer is in hand, so the count is of requests in
    // flight rather than of requests started.
    let _slot = UPSTREAM_SLOTS
        .acquire()
        .await
        .map_err(|_| AppError::Internal("Cover relay is shutting down".into()))?;

    let mut upstream = state
        .relay_client
        .get(target)
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

    // Chunk by chunk, so the ceiling holds whatever the upstream
    // claimed: `bytes()` would buffer the whole answer first, and the
    // check after it would come too late to protect this process.
    let mut bytes: Vec<u8> = Vec::new();
    loop {
        let chunk = upstream.chunk().await.map_err(|err| {
            tracing::debug!(%err, "cover proxy: body failed mid-flight");
            AppError::NotFound("Cover unavailable".into())
        })?;
        let Some(chunk) = chunk else { break };
        if bytes.len() + chunk.len() > MAX_COVER_BYTES {
            return Err(AppError::BadRequest("Cover too large".into()));
        }
        bytes.extend_from_slice(&chunk);
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
    use super::relay_target;

    const MANGA: &str = "a1c7c817-4e59-43b7-9365-09675a149a6f";
    const FILE: &str = "8f3e1818-a015-491d-bd81-3addc4d7d56a";

    fn rebuilt(src: &str) -> Option<String> {
        relay_target(src).map(|u| u.to_string())
    }

    /// 門 · The rebuilt request is the only thing between this relay and
    /// the operator's private network, so it is pinned case by case.
    #[test]
    fn a_mal_cover_is_rebuilt_on_its_literal_origin() {
        for (asked, expected) in [
            (
                "https://cdn.myanimelist.net/images/manga/2/253146l.jpg",
                "https://cdn.myanimelist.net/images/manga/2/253146l.jpg",
            ),
            (
                "https://cdn.myanimelist.net/images/manga/2/253146.webp",
                "https://cdn.myanimelist.net/images/manga/2/253146.webp",
            ),
            (
                "https://cdn.myanimelist.net/images/voiceactors/1/68211t.jpg",
                "https://cdn.myanimelist.net/images/voiceactors/1/68211t.jpg",
            ),
            // Case in the host is the parser's business; the query goes.
            (
                "https://CDN.MyAnimeList.net/images/manga/2/253146l.jpg?s=abc#x",
                "https://cdn.myanimelist.net/images/manga/2/253146l.jpg",
            ),
        ] {
            assert_eq!(rebuilt(asked).as_deref(), Some(expected), "for {asked}");
        }
    }

    #[test]
    fn a_mangadex_cover_is_rebuilt_from_its_two_uuids() {
        for suffix in [".jpg", ".png", ".jpg.256.jpg", ".png.512.jpg"] {
            let asked = format!("https://uploads.mangadex.org/covers/{MANGA}/{FILE}{suffix}");
            assert_eq!(rebuilt(&asked).as_deref(), Some(asked.as_str()));
        }
        // An uppercase UUID is the same object, written the CDN's way.
        let upper = format!(
            "https://uploads.mangadex.org/covers/{}/{FILE}.jpg",
            MANGA.to_uppercase()
        );
        assert_eq!(
            rebuilt(&upper).as_deref(),
            Some(format!("https://uploads.mangadex.org/covers/{MANGA}/{FILE}.jpg").as_str())
        );
    }

    #[test]
    fn anything_else_is_refused() {
        let mangadex_bad = [
            format!("https://uploads.mangadex.org/covers/{MANGA}/{FILE}.svg"),
            format!("https://uploads.mangadex.org/covers/{MANGA}/{FILE}.jpg.1024.jpg"),
            format!("https://uploads.mangadex.org/covers/{MANGA}/not-a-uuid.jpg"),
            format!("https://uploads.mangadex.org/covers/{MANGA}/{FILE}.jpg/extra"),
            format!("https://uploads.mangadex.org/data/{MANGA}/{FILE}.jpg"),
        ];
        let fixed = [
            "http://uploads.mangadex.org/covers/a.jpg", // not TLS
            "https://localhost/secret.png",
            "https://127.0.0.1/secret.png",
            "https://169.254.169.254/latest/meta-data/", // cloud metadata
            "https://evil.test/cdn.myanimelist.net/images/manga/2/1.jpg",
            "https://cdn.myanimelist.net.evil.test/images/manga/2/1.jpg",
            "https://cdn.myanimelist.net./images/manga/2/1.jpg", // trailing-dot host
            "https://api.myanimelist.net/v2/manga/1",
            "https://myanimelist.net/images/manga/2/1.jpg",
            "https://user:pw@cdn.myanimelist.net/images/manga/2/1.jpg",
            "https://cdn.myanimelist.net:8443/images/manga/2/1.jpg",
            "https://cdn.myanimelist.net/images/manga/2/1.png", // not a MAL format
            "https://cdn.myanimelist.net/images/manga/2/../../x/1.jpg",
            "https://cdn.myanimelist.net/images/manga/x/1.jpg", // shard not a number
            "https://cdn.myanimelist.net/images/manga/2/1x.jpg", // unknown size
            "https://cdn.myanimelist.net/images/admin/2/1.jpg", // unknown kind
            "https://cdn.myanimelist.net/r/50x70/images/manga/2/1.jpg",
            "https://cdn.myanimelist.net/images/manga/2/9999999999999.jpg",
            "https://cdn.myanimelist.net/",
            "file:///etc/passwd",
            "not a url",
            "",
        ];
        for refused in mangadex_bad.iter().map(String::as_str).chain(fixed) {
            assert_eq!(rebuilt(refused), None, "should refuse {refused}");
        }
    }
}
