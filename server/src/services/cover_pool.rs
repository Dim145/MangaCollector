use std::collections::HashSet;

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
    let (mal_urls, md_urls) = tokio::join!(mal_fut, md_fut);

    let mut out: Vec<String> = Vec::with_capacity(mal_urls.len() + md_urls.len());
    let mut seen: HashSet<String> = HashSet::new();
    for url in mal_urls.into_iter().chain(md_urls.into_iter()) {
        if seen.insert(url.clone()) {
            out.push(url);
        }
    }
    out
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
