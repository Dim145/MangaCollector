use std::collections::BTreeMap;
use std::time::Duration;

use anyhow::Context;
use serde::{Deserialize, Serialize};

use crate::services::cache::CacheStore;

/// Positive hits (cover found) are rock-stable on MangaDex — 7 days is safe.
const MANGADEX_HIT_TTL: Duration = Duration::from_secs(7 * 24 * 3600);
/// Negative hits (series absent) get a shorter TTL: new manga might be added
/// to MangaDex later, so we re-check every 24h.
const MANGADEX_MISS_TTL: Duration = Duration::from_secs(24 * 3600);
/// Search results — slightly volatile (new titles arrive), keep them for a
/// quarter-hour. Covers the typical "search, refine, re-search" session.
const MANGADEX_SEARCH_TTL: Duration = Duration::from_secs(15 * 60);
/// Standard User-Agent — MangaDex rejects requests without one (HTTP 400).
const USER_AGENT: &str = concat!("MangaCollector/", env!("CARGO_PKG_VERSION"));

/// MangaDex search response (only the fields we care about).
#[derive(Deserialize)]
struct MdMangaList {
    data: Vec<MdManga>,
}

#[derive(Deserialize)]
struct MdManga {
    id: String,
    attributes: MdMangaAttrs,
    #[serde(default)]
    relationships: Vec<MdRelationship>,
}

#[derive(Deserialize, Default)]
struct MdMangaAttrs {
    #[serde(default)]
    title: BTreeMap<String, String>,
    #[serde(default, rename = "altTitles")]
    alt_titles: Vec<BTreeMap<String, String>>,
    #[serde(default)]
    year: Option<i32>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default, rename = "lastVolume")]
    last_volume: Option<String>,
    #[serde(default, rename = "contentRating")]
    content_rating: Option<String>,
    #[serde(default)]
    tags: Vec<MdTag>,
    #[serde(default)]
    links: Option<MdLinks>,
}

#[derive(Deserialize, Default)]
struct MdLinks {
    /// MAL ID as a string (e.g. "1234") — MangaDex stores it stringly.
    #[serde(default)]
    mal: Option<String>,
}

#[derive(Deserialize)]
struct MdTag {
    attributes: MdTagAttrs,
}

#[derive(Deserialize)]
struct MdTagAttrs {
    #[serde(default)]
    name: BTreeMap<String, String>,
    #[serde(default)]
    group: String,
}

#[derive(Deserialize)]
struct MdRelationship {
    #[serde(rename = "type")]
    rel_type: String,
    #[serde(default)]
    attributes: Option<MdCoverAttrs>,
}

#[derive(Deserialize, Default)]
struct MdCoverAttrs {
    #[serde(rename = "fileName", default)]
    file_name: Option<String>,
}

/// Shape returned to callers (and to the merged-search service).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MangadexResult {
    pub mangadex_id: String,
    pub mal_id: Option<i32>,
    pub name: String,
    pub image_url: Option<String>,
    /// Empty when MangaDex doesn't publish a fixed volume count (common).
    pub volumes: Option<i32>,
    /// Genres + themes combined — excludes "format" and "content" groups so
    /// we don't pollute the user's genre list with stuff like "Full Color".
    pub genres: Vec<String>,
    pub year: Option<i32>,
    pub status: Option<String>,
    pub content_rating: Option<String>,
}

/// Search MangaDex by title hint, then cross-reference the MAL id via
/// `attributes.links.mal` to make sure we match the right series. Returns a
/// direct uploads.mangadex.org URL for the preferred cover, or `None` if the
/// series isn't on MangaDex or the lookup fails.
pub async fn find_cover_url_by_mal_id(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    mal_id: i32,
    title_hint: &str,
) -> anyhow::Result<Option<String>> {
    if title_hint.trim().is_empty() {
        return Ok(None);
    }

    let cache_key = format!("mangadex:cover:{}", mal_id);
    if let Some(cache) = cache
        && let Some(cached) = cache.get::<Option<String>>(&cache_key).await {
            return Ok(cached);
        }

    let results = fetch_mangadex_search(client, title_hint).await?;
    let mal_str = mal_id.to_string();

    let found = results
        .into_iter()
        .find(|m| m.mal_id == Some(mal_id) || links_mal_matches(m, &mal_str))
        .and_then(|m| m.image_url);

    if let Some(cache) = cache {
        let ttl = if found.is_some() {
            MANGADEX_HIT_TTL
        } else {
            MANGADEX_MISS_TTL
        };
        cache.set(&cache_key, &found, ttl).await;
    }

    Ok(found)
}

// Helper only used above to keep the post-search cross-ref readable.
fn links_mal_matches(m: &MangadexResult, mal_str: &str) -> bool {
    m.mal_id.map(|id| id.to_string()) == Some(mal_str.to_string())
}

/// Search MangaDex by free-text title. Returns a handful of rich results
/// suitable for display in the unified search UI. Cached for 15 min.
pub async fn search_by_title(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    query: &str,
) -> anyhow::Result<Vec<MangadexResult>> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let cache_key = format!("mangadex:search:{}", trimmed.to_lowercase());
    if let Some(cache) = cache
        && let Some(cached) = cache.get::<Vec<MangadexResult>>(&cache_key).await {
            return Ok(cached);
        }

    let results = fetch_mangadex_search(client, trimmed).await?;
    if let Some(cache) = cache {
        cache.set(&cache_key, &results, MANGADEX_SEARCH_TTL).await;
    }
    Ok(results)
}

/// One cover entry from MangaDex. Keeps the raw `volume` string and locale
/// so callers can pick the right one for e.g. volume-icon rendering.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MdCoverEntry {
    pub url: String,
    /// `"1"`, `"2"`, `"1.5"`, `"special"`… or empty. Kept as-is; callers
    /// that need a number parse themselves.
    pub volume: Option<String>,
    pub locale: Option<String>,
}

/// Fetch EVERY cover MangaDex publishes for a manga UUID — typically one
/// per volume. Richer than `find_cover_url_by_mal_id` (which only returns
/// the default cover). Used by the cover-picker AND the per-volume cover
/// feature.
///
/// Ordering: Japanese jackets first (most consistent quality), then other
/// locales. Deduped by URL.
pub async fn fetch_all_covers_for_manga(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    mangadex_id: &str,
) -> anyhow::Result<Vec<MdCoverEntry>> {
    let cache_key = format!("mangadex:allcovers:{}", mangadex_id);
    if let Some(cache) = cache
        && let Some(cached) = cache.get::<Vec<MdCoverEntry>>(&cache_key).await {
            return Ok(cached);
        }

    let response = client
        .get("https://api.mangadex.org/cover")
        .header("User-Agent", USER_AGENT)
        .query(&[
            ("manga[]", mangadex_id),
            ("limit", "100"),
            ("order[volume]", "asc"),
        ])
        .send()
        .await
        .context("Failed to reach MangaDex /cover")?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        tracing::warn!(mangadex_id, %status, body, "mangadex: non-2xx on /cover");
        return Ok(Vec::new());
    }

    #[derive(Deserialize)]
    struct CoverList {
        data: Vec<CoverEntry>,
    }
    #[derive(Deserialize)]
    struct CoverEntry {
        attributes: CoverAttrs,
    }
    #[derive(Deserialize)]
    struct CoverAttrs {
        #[serde(rename = "fileName", default)]
        file_name: Option<String>,
        #[serde(default)]
        locale: Option<String>,
        #[serde(default)]
        volume: Option<String>,
    }

    let parsed: CoverList = response
        .json()
        .await
        .context("Failed to parse MangaDex /cover response")?;

    // Japanese jackets first, others after — dedup by URL.
    let mut jp: Vec<MdCoverEntry> = Vec::new();
    let mut other: Vec<MdCoverEntry> = Vec::new();
    for entry in parsed.data {
        let Some(file) = entry.attributes.file_name else {
            continue;
        };
        let url = format!(
            "https://uploads.mangadex.org/covers/{}/{}",
            mangadex_id, file
        );
        let item = MdCoverEntry {
            url,
            volume: entry
                .attributes
                .volume
                .filter(|v| !v.is_empty()),
            locale: entry.attributes.locale,
        };
        if item.locale.as_deref() == Some("ja") {
            jp.push(item);
        } else {
            other.push(item);
        }
    }
    let mut out = jp;
    out.extend(other);
    // Dedup while preserving order
    let mut seen = std::collections::HashSet::new();
    out.retain(|c| seen.insert(c.url.clone()));

    if let Some(cache) = cache {
        cache.set(&cache_key, &out, MANGADEX_HIT_TTL).await;
    }
    Ok(out)
}

/// Fetch a single MangaDex manga by its UUID. Used for the
/// "refresh from MangaDex" flow when the entry carries a mangadex_id.
pub async fn get_by_id(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    mangadex_id: &str,
) -> anyhow::Result<Option<MangadexResult>> {
    let cache_key = format!("mangadex:byid:{}", mangadex_id);
    if let Some(cache) = cache
        && let Some(cached) = cache.get::<Option<MangadexResult>>(&cache_key).await {
            return Ok(cached);
        }

    let url = format!("https://api.mangadex.org/manga/{}", mangadex_id);
    let response = client
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .query(&[("includes[]", "cover_art")])
        .send()
        .await
        .context("Failed to reach MangaDex API")?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        tracing::warn!(mangadex_id, %status, body, "mangadex: non-2xx response on byId");
        return Ok(None);
    }

    #[derive(Deserialize)]
    struct OneManga {
        data: MdManga,
    }
    let parsed: OneManga = response
        .json()
        .await
        .context("Failed to parse MangaDex byId response")?;

    let result = Some(into_result(parsed.data));

    if let Some(cache) = cache {
        cache.set(&cache_key, &result, MANGADEX_HIT_TTL).await;
    }
    Ok(result)
}

/// Shared HTTP path — builds the query, enforces the User-Agent, handles
/// the reply → Vec<MangadexResult> conversion. Kept private so each public
/// entry-point owns its own caching logic.
async fn fetch_mangadex_search(
    client: &reqwest::Client,
    title: &str,
) -> anyhow::Result<Vec<MangadexResult>> {
    // Explicit content-rating list: without this MangaDex hides erotica and
    // pornographic results. We include them all so adult covers work.
    let query = [
        ("title", title),
        ("limit", "10"),
        ("includes[]", "cover_art"),
        ("contentRating[]", "safe"),
        ("contentRating[]", "suggestive"),
        ("contentRating[]", "erotica"),
        ("contentRating[]", "pornographic"),
        ("order[relevance]", "desc"),
    ];

    let response = client
        .get("https://api.mangadex.org/manga")
        .header("User-Agent", USER_AGENT)
        .query(&query)
        .send()
        .await
        .context("Failed to reach MangaDex API")?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        tracing::warn!(%status, body, "mangadex: non-2xx response on search");
        return Ok(Vec::new());
    }

    let parsed: MdMangaList = response
        .json()
        .await
        .context("Failed to parse MangaDex search response")?;

    Ok(parsed.data.into_iter().map(into_result).collect())
}

/// Convert the raw MangaDex payload into the shape callers consume.
fn into_result(entry: MdManga) -> MangadexResult {
    let attrs = entry.attributes;

    // Pick the best display title: prefer English → Romaji Japanese →
    // original-lang → first alt title → UUID fallback. Matches the user's
    // expectation when the search surfaces the manga.
    let name = attrs
        .title
        .get("en")
        .or_else(|| attrs.title.get("ja-ro"))
        .or_else(|| attrs.title.values().next())
        .cloned()
        .or_else(|| {
            attrs
                .alt_titles
                .iter()
                .find_map(|m| m.get("en").or_else(|| m.get("ja-ro")).cloned())
        })
        .unwrap_or_else(|| entry.id.clone());

    // Filter tags: keep genre + theme, skip format/content (e.g. "Full Color",
    // "Long Strip" aren't useful as genres).
    let mut genres: Vec<String> = attrs
        .tags
        .iter()
        .filter(|t| matches!(t.attributes.group.as_str(), "genre" | "theme"))
        .filter_map(|t| {
            t.attributes
                .name
                .get("en")
                .or_else(|| t.attributes.name.values().next())
                .cloned()
        })
        .collect();

    // MangaDex doesn't publish a "Hentai" tag — they signal explicit content
    // via `contentRating: "pornographic"` instead. Inject the tag so the rest
    // of the app (adult-content filter, cover-upgrade heuristic, blur logic)
    // keeps working without needing to know about contentRating.
    if attrs.content_rating.as_deref() == Some("pornographic")
        && !genres.iter().any(|g| g.eq_ignore_ascii_case("hentai"))
    {
        genres.push("Hentai".to_string());
    }

    let mal_id = attrs
        .links
        .as_ref()
        .and_then(|l| l.mal.as_deref())
        .and_then(|s| s.parse::<i32>().ok());

    let image_url = entry
        .relationships
        .iter()
        .find(|r| r.rel_type == "cover_art")
        .and_then(|r| r.attributes.as_ref())
        .and_then(|a| a.file_name.as_deref())
        .map(|file| format!("https://uploads.mangadex.org/covers/{}/{}", entry.id, file));

    // `lastVolume` is usually "" or a number-ish string. Parse loosely; None
    // when MangaDex doesn't track it (common on ongoing series).
    let volumes = attrs
        .last_volume
        .as_deref()
        .and_then(|v| v.trim().parse::<i32>().ok());

    MangadexResult {
        mangadex_id: entry.id,
        mal_id,
        name,
        image_url,
        volumes,
        genres,
        year: attrs.year,
        status: attrs.status,
        content_rating: attrs.content_rating,
    }
}
