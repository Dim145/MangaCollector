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
