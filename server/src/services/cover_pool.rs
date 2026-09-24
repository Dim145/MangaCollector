use std::collections::{HashMap, HashSet};

use crate::services::cache::CacheStore;
use crate::services::{mal_api, mangadex_api};

/// Aggregate alternate-cover URLs for a series from every source we know
/// about:
///   - MAL pictures (3–8 typical for popular series)
///   - MangaDex covers (one per volume, richer for long-running series)
///
/// Runs both fetches in parallel, dedupes by URL, preserves order (MAL
/// first, then MangaDex) so the most "canonical" covers appear first.
///
/// Best-effort: if either source fails, we return whatever the other one
/// produced. Empty Vec means neither source knows about this series (e.g.
/// pure-custom entry with a fake mal_id).
pub async fn fetch_cover_pool(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    mal_id: Option<i32>,
    mangadex_id: Option<&str>,
) -> Vec<String> {
    // Spawn both calls in parallel. `tokio::join!` waits on the slowest,
    // not the sum — meaningful on cold cache (both ~100-300ms).
    let mal_fut = async {
        match mal_id {
            Some(id) if id > 0 => mal_api::get_pictures(client, cache, id)
                .await
                .unwrap_or_default(),
            _ => Vec::new(),
        }
    };
    let md_fut = async {
        match mangadex_id {
            Some(uuid) if !uuid.trim().is_empty() => {
                mangadex_api::fetch_all_covers_for_manga(client, cache, uuid)
                    .await
                    .unwrap_or_default()
            }
            _ => Vec::new(),
        }
    };
    let (mal_urls, md_entries) = tokio::join!(mal_fut, md_fut);

    let mut out: Vec<String> = Vec::with_capacity(mal_urls.len() + md_entries.len());
    let mut seen: HashSet<String> = HashSet::new();
    for url in mal_urls
        .into_iter()
        .chain(md_entries.into_iter().map(|c| c.url))
    {
        if seen.insert(url.clone()) {
            out.push(url);
        }
    }
    out
}

/// Build the per-volume cover map consumed by the volume-icon feature.
///
/// MangaDex is the only source that publishes covers keyed by volume, so
/// MAL isn't used here. Parses `volume` strings like "1", "2", "12" into
/// i32 keys; non-integer volumes ("1.5", "special") are dropped. When
/// multiple covers exist for the same volume (regional variants), the
/// first one (ordered with JA preference upstream) wins.
pub async fn fetch_volume_covers(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    mangadex_id: Option<&str>,
) -> HashMap<i32, String> {
    let Some(uuid) = mangadex_id.filter(|s| !s.trim().is_empty()) else {
        return HashMap::new();
    };
    let covers = match mangadex_api::fetch_all_covers_for_manga(client, cache, uuid).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(mangadex_id = uuid, error = %e, "volume-covers: fetch failed");
            return HashMap::new();
        }
    };

    let mut map: HashMap<i32, String> = HashMap::new();
    let mut unnumbered: Vec<String> = Vec::new();

    for entry in covers {
        match entry.volume.as_deref() {
            Some(raw) => {
                if let Ok(num) = raw.trim().parse::<i32>() {
                    // First writer wins — upstream already ordered JA
                    // covers before others.
                    map.entry(num).or_insert(entry.url);
                } else {
                    // "1.5", "special", etc. — skip, no clean mapping.
                }
            }
            None => unnumbered.push(entry.url),
        }
    }

    // Oneshot fallback: when MangaDex publishes a single cover with no
    // volume number (common for oneshots, doujins, and series whose
    // volume metadata simply isn't maintained), use it for volume 1.
    // Matches the user's mental model — "there's one cover, it's the
    // cover of my single volume". We only apply this fallback when NO
    // numbered cover was found, to avoid silently duplicating covers for
    // multi-volume series where some entries happen to lack a number.
    if map.is_empty()
        && let Some(first) = unnumbered.into_iter().next()
    {
        map.insert(1, first);
    }

    map
}

/// Whitelist of hosts we accept for a "set this as my cover" request. The
/// picker-modal only surfaces URLs returned by `fetch_cover_pool`, so all
/// legitimate picks will match. Rejecting anything else closes the door on
/// a user crafting a request with a URL pointing to a tracking pixel or
/// arbitrary host.
/// Hosts a stored cover URL may point at — the same list the client's
/// CSP `img-src` allows (client/nginx.conf), so what passes here also
/// renders. Applied wherever a cover URL enters the database from
/// outside: archive import, external imports, a client-supplied cover on
/// add. Own posters are server-relative paths and pass untouched.
pub const COVER_HOSTS: [&str; 8] = [
    "myanimelist.net",
    "mangadex.org",
    "images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com",
    "anilist.co",
    "books.google.com",
    "googleusercontent.com",
    "covers.openlibrary.org",
    "openlibrary.org",
];

fn host_allowed(host: &str, allowed: &[&str]) -> bool {
    let host = host.to_ascii_lowercase();
    allowed
        .iter()
        .any(|s| host == *s || host.ends_with(&format!(".{s}")))
}

/// The one server-relative cover this app ever stores: a custom poster,
/// `/api/user/storage/poster/{mal_id}` (a custom series has a negative
/// id). Written by the upload handler and by the copy-from-a-friend
/// path, and nothing else.
pub fn is_own_poster_path(text: &str) -> bool {
    let Some(id) = text.strip_prefix("/api/user/storage/poster/") else {
        return false;
    };
    let digits = id.strip_prefix('-').unwrap_or(id);
    !digits.is_empty() && digits.len() <= 10 && digits.bytes().all(|b| b.is_ascii_digit())
}

/// How another user's cover is shown to a viewer.
///
/// An external CDN address passes through. The owner's custom poster,
/// stored as `/api/user/storage/poster/{id}`, would resolve against the
/// *viewer's* library — the viewer's own cover for that series, or a
/// 404 — so it becomes the owner's public poster path. Without a public
/// profile there is nowhere to serve it from, and the answer is no
/// cover rather than the wrong one.
pub fn cover_seen_by_others(
    image: Option<&str>,
    owner_slug: Option<&str>,
    mal_id: i32,
) -> Option<String> {
    let image = image?;
    if is_own_poster_path(image) {
        return owner_slug.map(|slug| format!("/api/public/u/{slug}/poster/{mal_id}"));
    }
    allowed_cover_url(Some(image)).filter(|url| !url.starts_with('/'))
}

/// A cover URL as it may be stored: `None` when blank or from a host we
/// do not serve. `http://` on an allowed host is upgraded to `https://`
/// (Google Books thumbnails still come as http).
///
/// 門 · A server-relative path is kept only when it is a custom poster.
/// "Starts with `/`" used to be enough, and it was not a check at all:
/// a browser reads `/\evil.test/a.jpg` (or `/<TAB>/evil.test/a.jpg`) as
/// `https://evil.test/a.jpg`, so a cover stored that way loaded an
/// image from any host on every follower's screen — a tracking pixel
/// past the host allow-list. And a same-origin path such as
/// `/api/user/export.json` made each viewer's browser request it with
/// the viewer's own cookies.
pub fn allowed_cover_url(raw: Option<&str>) -> Option<String> {
    let text = raw?.trim();
    if text.is_empty() {
        return None;
    }
    if text.starts_with('/') || text.starts_with('\\') {
        return is_own_poster_path(text).then(|| text.to_string());
    }
    let mut url = url::Url::parse(text).ok()?;
    match url.scheme() {
        "https" => {}
        "http" => url.set_scheme("https").ok()?,
        _ => return None,
    }
    if url.username() != "" || url.password().is_some() {
        return None;
    }
    let host = url.host_str()?;
    host_allowed(host, &COVER_HOSTS).then(|| url.to_string())
}

pub fn is_whitelisted_poster_url(url: &str) -> bool {
    const ALLOWED_SUFFIXES: [&str; 3] = [
        ".myanimelist.net",
        "myanimelist.net",
        "uploads.mangadex.org",
    ];
    url.starts_with("https://")
        && url::Url::parse(url)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string))
            .map(|host| {
                ALLOWED_SUFFIXES
                    .iter()
                    .any(|s| host == *s || host.ends_with(&format!(".{}", s.trim_start_matches('.'))))
            })
            .unwrap_or(false)
}

#[cfg(test)]
mod allowlist_tests {
    use super::{allowed_cover_url, cover_seen_by_others};

    #[test]
    fn another_users_poster_is_shown_from_their_public_path() {
        assert_eq!(
            cover_seen_by_others(Some("/api/user/storage/poster/13"), Some("alex"), 13).as_deref(),
            Some("/api/public/u/alex/poster/13")
        );
        // No public profile: no cover, rather than the viewer's own.
        assert_eq!(
            cover_seen_by_others(Some("/api/user/storage/poster/13"), None, 13),
            None
        );
        // An external CDN cover passes through.
        assert_eq!(
            cover_seen_by_others(
                Some("https://cdn.myanimelist.net/images/manga/1/1.jpg"),
                None,
                1
            )
            .as_deref(),
            Some("https://cdn.myanimelist.net/images/manga/1/1.jpg")
        );
        // Anything stored before the allow-list was strict is dropped.
        assert_eq!(
            cover_seen_by_others(Some("/\\evil.test/a.jpg"), Some("alex"), 1),
            None
        );
        assert_eq!(
            cover_seen_by_others(Some("/api/user/export.json"), Some("alex"), 1),
            None
        );
    }

    #[test]
    fn keeps_known_hosts_and_own_paths() {
        assert_eq!(
            allowed_cover_url(Some("https://cdn.myanimelist.net/images/manga/1/1.jpg")),
            Some("https://cdn.myanimelist.net/images/manga/1/1.jpg".into())
        );
        assert_eq!(
            allowed_cover_url(Some(" https://uploads.mangadex.org/covers/x/y.jpg ")),
            Some("https://uploads.mangadex.org/covers/x/y.jpg".into())
        );
        assert_eq!(
            allowed_cover_url(Some("/api/user/storage/poster/13")),
            Some("/api/user/storage/poster/13".into())
        );
    }

    #[test]
    fn upgrades_http_on_allowed_hosts_only() {
        assert_eq!(
            allowed_cover_url(Some("http://books.google.com/books/content?id=1&zoom=1")),
            Some("https://books.google.com/books/content?id=1&zoom=1".into())
        );
        assert_eq!(allowed_cover_url(Some("http://evil.example/x.jpg")), None);
    }

    /// Un hôte autorisé avec des identifiants dans l'URL : le seul
    /// motif de refus est le garde sur `username` / `password`, donc
    /// il est éprouvé seul. L'ancien test passait par un hôte
    /// lookalike, qui échouait de toute façon sur la liste d'hôtes.
    #[test]
    fn refuses_credentials_even_on_an_allowed_host() {
        assert_eq!(
            allowed_cover_url(Some("https://someone@cdn.myanimelist.net/a.jpg")),
            None
        );
        assert_eq!(
            allowed_cover_url(Some("https://:secret@cdn.myanimelist.net/a.jpg")),
            None
        );
        assert_eq!(
            allowed_cover_url(Some("https://user:secret@uploads.mangadex.org/a.jpg")),
            None
        );
    }

    #[test]
    fn drops_unknown_hosts_lookalikes_and_junk() {
        assert_eq!(
            allowed_cover_url(Some("https://evil.example/mal.jpg")),
            None
        );
        assert_eq!(
            allowed_cover_url(Some("https://myanimelist.net.evil.example/a.jpg")),
            None
        );
        assert_eq!(
            allowed_cover_url(Some("https://cdn.myanimelist.net@evil.example/a.jpg")),
            None
        );
        assert_eq!(allowed_cover_url(Some("//cdn.myanimelist.net/a.jpg")), None);
        assert_eq!(allowed_cover_url(Some("/api/../etc/passwd")), None);
        // A browser reads these as `https://evil.test/a.jpg`.
        assert_eq!(allowed_cover_url(Some("/\\evil.test/a.jpg")), None);
        assert_eq!(allowed_cover_url(Some("/\t/evil.test/a.jpg")), None);
        assert_eq!(allowed_cover_url(Some("\\\\evil.test/a.jpg")), None);
        // Same origin, and still not a cover: it would be requested by
        // every viewer's browser with the viewer's cookies.
        assert_eq!(allowed_cover_url(Some("/api/user/export.json")), None);
        assert_eq!(allowed_cover_url(Some("/api/user/calendar/ics-url")), None);
        assert_eq!(
            allowed_cover_url(Some("/api/user/storage/poster/13/../x")),
            None
        );
        assert_eq!(allowed_cover_url(Some("/api/user/storage/poster/")), None);
        // A custom series has a negative id.
        assert_eq!(
            allowed_cover_url(Some("/api/user/storage/poster/-120")),
            Some("/api/user/storage/poster/-120".into())
        );
        assert_eq!(allowed_cover_url(Some("javascript:alert(1)")), None);
        assert_eq!(allowed_cover_url(Some("   ")), None);
        assert_eq!(allowed_cover_url(None), None);
    }
}

/// 印 · La porte d'entrée d'une couverture choisie par l'utilisateur
/// (`POST /library/{mal_id}/poster`). Elle n'avait aucun test : la
/// remplacer par `true` ou par `false` ne faisait échouer personne.
#[cfg(test)]
mod poster_allowlist_tests {
    use super::is_whitelisted_poster_url;

    #[test]
    fn accepts_the_hosts_the_picker_can_offer() {
        assert!(is_whitelisted_poster_url(
            "https://cdn.myanimelist.net/images/manga/1/1.jpg"
        ));
        // l'hôte nu, pas seulement un sous-domaine
        assert!(is_whitelisted_poster_url("https://myanimelist.net/a.jpg"));
        assert!(is_whitelisted_poster_url(
            "https://uploads.mangadex.org/covers/x/y.jpg"
        ));
    }

    #[test]
    fn refuses_plain_http_on_an_allowed_host() {
        assert!(!is_whitelisted_poster_url(
            "http://cdn.myanimelist.net/images/manga/1/1.jpg"
        ));
    }

    #[test]
    fn refuses_lookalikes_and_anything_else() {
        assert!(!is_whitelisted_poster_url(
            "https://myanimelist.net.evil.example/a.jpg"
        ));
        assert!(!is_whitelisted_poster_url(
            "https://uploads.mangadex.org.evil.example/a.jpg"
        ));
        assert!(!is_whitelisted_poster_url("https://evil.example/a.jpg"));
        assert!(!is_whitelisted_poster_url("https://"));
        assert!(!is_whitelisted_poster_url("not a url"));
        assert!(!is_whitelisted_poster_url(""));
    }
}
