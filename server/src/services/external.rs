use serde::{Deserialize, Serialize};

use crate::services::cache::CacheStore;
use crate::services::mal_api::{self, MalSearchResult};
use crate::services::mangadex_api::{self, MangadexResult};

/// Unified shape shipped back to the client. Carries both IDs when the
/// entry is present on both sources so the client can offer "refresh from
/// MangaDex" later without an extra lookup.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnifiedSearchResult {
    /// `"mal"`, `"mangadex"`, or `"both"`. The UI can decide what badge to
    /// display and which add-flow to invoke.
    pub source: String,
    pub mal_id: Option<i32>,
    pub mangadex_id: Option<String>,
    pub name: String,
    pub image_url: Option<String>,
    pub volumes: Option<i32>,
    pub genres: Vec<String>,
    pub score: Option<f64>,
    pub content_rating: Option<String>,
}

/// Parallel search on both APIs + merge. Merge rule (as specified by the
/// product): when the same series is returned by BOTH sources, keep MAL's
/// data for *everything* except the cover image, which MangaDex always wins.
/// Unmatched MangaDex hits are appended at the end of the list with
/// `source: "mangadex"` so the user can still discover series MAL doesn't
/// know about.
///
/// Both API calls run concurrently via `tokio::join!` — the merge is waiting
/// on the slowest of the two, not the sum.
pub async fn merged_search(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    query: &str,
) -> Vec<UnifiedSearchResult> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let (mal_res, md_res) = tokio::join!(
        mal_api::search_by_title(client, cache, trimmed),
        mangadex_api::search_by_title(client, cache, trimmed),
    );

    let mal_list = mal_res.unwrap_or_else(|e| {
        tracing::warn!(error = %e, "merged_search: MAL lookup failed");
        Vec::new()
    });
    let md_list = md_res.unwrap_or_else(|e| {
        tracing::warn!(error = %e, "merged_search: MangaDex lookup failed");
        Vec::new()
    });

    merge(mal_list, md_list)
}

/// Pure merge logic — split out to stay testable without network.
fn merge(
    mal_list: Vec<MalSearchResult>,
    md_list: Vec<MangadexResult>,
) -> Vec<UnifiedSearchResult> {
    let mut out: Vec<UnifiedSearchResult> = Vec::with_capacity(mal_list.len() + md_list.len());
    let mut consumed_md_ids: std::collections::HashSet<String> = Default::default();

    // Build a quick MAL-id → MangaDex entry lookup so we can cross-link in O(1).
    let md_by_mal: std::collections::HashMap<i32, &MangadexResult> = md_list
        .iter()
        .filter_map(|m| m.mal_id.map(|id| (id, m)))
        .collect();

    // Pass 1 — every MAL result, possibly enriched with MangaDex cover.
    for mal in mal_list {
        let md_match = md_by_mal.get(&mal.mal_id).copied();
        let (image_url, source, mangadex_id) = match md_match {
            // Cross-linked: MAL data, MangaDex image.
            Some(md) => {
                consumed_md_ids.insert(md.mangadex_id.clone());
                (
                    md.image_url.clone().or(mal.image_url.clone()),
                    "both".to_string(),
                    Some(md.mangadex_id.clone()),
                )
            }
            None => (mal.image_url.clone(), "mal".to_string(), None),
        };
        out.push(UnifiedSearchResult {
            source,
            mal_id: Some(mal.mal_id),
            mangadex_id,
            name: mal.name,
            image_url,
            volumes: mal.volumes,
            genres: mal.genres,
            score: mal.score,
            content_rating: None,
        });
    }

    // Pass 2 — MangaDex entries that weren't cross-linked. They may or may
    // not have a MAL id in their metadata; either way we surface them as
    // MangaDex-only so the user can still add them.
    for md in md_list {
        if consumed_md_ids.contains(&md.mangadex_id) {
            continue;
        }
        out.push(UnifiedSearchResult {
            source: "mangadex".to_string(),
            mal_id: md.mal_id,
            mangadex_id: Some(md.mangadex_id),
            name: md.name,
            image_url: md.image_url,
            volumes: md.volumes,
            genres: md.genres,
            score: None,
            content_rating: md.content_rating,
        });
    }

    out
}
