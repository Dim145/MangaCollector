use std::collections::BTreeMap;
use std::time::Duration;

use anyhow::Context;
use serde::{Deserialize, Serialize};

use crate::services::cache::CacheStore;
use crate::util::url::build_url;

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
    /// How many series match in all, which can exceed this page.
    #[serde(default)]
    total: Option<usize>,
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

/// Searches by title that found no unique MAL match, remembered in memory so
/// that a library without a cache does not search again on every page view.
static LINK_MISSES: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<i32, std::time::Instant>>,
> = std::sync::LazyLock::new(Default::default);
const LINK_MISSES_CAP: usize = 4096;

/// One searcher at a time per instance, at least this far apart, from the
/// add, import and cover paths together. MangaDex allows about five requests
/// a second across everything this address does, covers and search included.
const LINK_SPACING: Duration = Duration::from_millis(400);
static LINK_NEXT_SLOT: std::sync::LazyLock<tokio::sync::Mutex<tokio::time::Instant>> =
    std::sync::LazyLock::new(|| tokio::sync::Mutex::new(tokio::time::Instant::now()));

async fn wait_for_link_slot() {
    let mut next = LINK_NEXT_SLOT.lock().await;
    tokio::time::sleep_until(*next).await;
    *next = tokio::time::Instant::now() + LINK_SPACING;
}

/// The MangaDex id of the series MangaDex itself says is MAL `mal_id`.
///
/// Searches by `title_hint` (one request, a full page of 100 results), then
/// accepts a result only when its `attributes.links.mal` is exactly `mal_id`,
/// so a title that merely looks alike never links. It links nothing when:
/// two entries claim the MAL id (an "Official Colored" edition next to the
/// original, say), or MangaDex has more matches for the title than one page
/// shows, so uniqueness cannot be established. The user can still pick by hand.
///
/// A series found is cached when a cache exists; one not found is remembered
/// for a day, in the cache or in memory, so repeated adds and page views cost
/// nothing. Searches are paced (see `LINK_SPACING`); an error is returned, not
/// remembered, so the next try asks again.
pub async fn find_id_by_mal_id(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    mal_id: i32,
    title_hint: &str,
) -> anyhow::Result<Option<String>> {
    if mal_id <= 0 || title_hint.trim().is_empty() {
        return Ok(None);
    }

    let cache_key = format!("mangadex:link:{}", mal_id);
    if let Some(cache) = cache
        && let Some(cached) = cache.get::<Option<String>>(&cache_key).await
    {
        return Ok(cached);
    }
    if let Some(at) = LINK_MISSES
        .lock()
        .ok()
        .and_then(|m| m.get(&mal_id).copied())
        && at.elapsed() < MANGADEX_MISS_TTL
    {
        return Ok(None);
    }

    // The stored title first; if that finds nothing (a Japanese name with the
    // romaji in brackets, say), one more search by its Latin-script part.
    // Never after an ambiguous answer: a second query would not make two
    // entries for one MAL id any less ambiguous.
    let mut found = None;
    let variant = latin_title_part(title_hint);
    for title in std::iter::once(title_hint.trim()).chain(variant.as_deref()) {
        wait_for_link_slot().await;
        match fetch_link_candidates(client, title)
            .await?
            .map_or(LinkMatch::None, |r| link_match(&r, mal_id))
        {
            LinkMatch::One(id) => {
                found = Some(id);
                break;
            }
            LinkMatch::Several => break,
            LinkMatch::None => {}
        }
    }

    if let Some(cache) = cache {
        let ttl = if found.is_some() {
            MANGADEX_HIT_TTL
        } else {
            MANGADEX_MISS_TTL
        };
        cache.set(&cache_key, &found, ttl).await;
    }
    if found.is_none()
        && let Ok(mut misses) = LINK_MISSES.lock()
    {
        if misses.len() >= LINK_MISSES_CAP {
            misses.clear();
        }
        misses.insert(mal_id, std::time::Instant::now());
    }

    Ok(found)
}

/// Up to 100 title matches, or `None` when MangaDex says it has more than it
/// returned (so "exactly one entry has this MAL id" cannot be known).
async fn fetch_link_candidates(
    client: &reqwest::Client,
    title: &str,
) -> anyhow::Result<Option<Vec<MangadexResult>>> {
    let query = [
        ("title", title),
        ("limit", "100"),
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
    if status.as_u16() == 429 {
        return Err(anyhow::Error::new(RateLimited));
    }
    if !status.is_success() {
        let body = log_excerpt(response.text().await.unwrap_or_default());
        tracing::warn!(%status, body, "mangadex: non-2xx on link search");
        anyhow::bail!("MangaDex link search non-success status: {status}");
    }

    let parsed: MdMangaList = response
        .json()
        .await
        .context("Failed to parse MangaDex link search response")?;
    Ok(whole_page(parsed))
}

/// The results, unless MangaDex has more matches than the page carries.
fn whole_page(list: MdMangaList) -> Option<Vec<MangadexResult>> {
    if list.total.is_some_and(|t| t > list.data.len()) {
        return None;
    }
    Some(list.data.into_iter().map(into_result).collect())
}

/// How many results carry MAL id `mal_id` in their MangaDex MAL link.
#[derive(Debug, PartialEq)]
enum LinkMatch {
    None,
    One(String),
    Several,
}

fn link_match(results: &[MangadexResult], mal_id: i32) -> LinkMatch {
    let mut hits = results
        .iter()
        .filter(|m| {
            m.mal_id == Some(mal_id) && crate::util::uuid::is_canonical_uuid(&m.mangadex_id)
        })
        .map(|m| m.mangadex_id.as_str());
    match (hits.next(), hits.next()) {
        (None, _) => LinkMatch::None,
        (Some(id), None) => LinkMatch::One(id.to_string()),
        _ => LinkMatch::Several,
    }
}

/// The part of a stored title worth a second search: the first bracketed
/// group that has Latin letters (`ブルーボックス (Blue Box)` → `Blue Box`),
/// else the longest run of Latin text (`ヒカルの碁 Hikaru no Go` →
/// `Hikaru no Go`). `None` when the title is already that part, or has none.
fn latin_title_part(title: &str) -> Option<String> {
    let title = title.trim();
    let has_letters = |s: &str| s.chars().filter(|c| c.is_ascii_alphabetic()).count() >= 3;
    let mut best: Option<String> = None;
    let mut open = None;
    for (i, c) in title.char_indices() {
        match c {
            '(' | '（' => open = Some(i + c.len_utf8()),
            ')' | '）' => {
                if let Some(start) = open.take()
                    && best.is_none()
                    && has_letters(&title[start..i])
                {
                    best = Some(title[start..i].trim().to_string());
                }
            }
            _ => {}
        }
    }
    if best.is_none() {
        let run = |c: char| c.is_ascii_alphanumeric() || " '!?:&.-".contains(c);
        best = title
            .split(|c: char| !run(c))
            .map(str::trim)
            .filter(|r| has_letters(r))
            .max_by_key(|r| r.len())
            .map(str::to_string);
    }
    best.map(|b| b.trim_matches(|c: char| " -–—:,".contains(c)).to_string())
        .filter(|b| has_letters(b) && b != title)
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
        let body = log_excerpt(response.text().await.unwrap_or_default());
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

    // 安 · URL via `Url::path_segments_mut` — CodeQL-recognised
    // sanitizer for `rust/request-forgery`. `mangadex_id` is also
    // validated as a canonical UUID upstream (see
    // `util::uuid::is_canonical_uuid`), so this is belt-and-braces.
    let url = build_url("https://api.mangadex.org/manga", &[mangadex_id])
        .map_err(|e| anyhow::anyhow!("MangaDex URL build: {e}"))?;
    let response = client
        .get(url)
        .header("User-Agent", USER_AGENT)
        .query(&[("includes[]", "cover_art")])
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .context("Failed to reach MangaDex API")?;

    let status = response.status();
    // 礼 · "Slow down" is not "not found": a caller walking a list has to
    // be able to tell, and stop, rather than carry on at the same pace
    // until the instance's address is banned for everyone.
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(anyhow::Error::new(RateLimited));
    }
    if !status.is_success() {
        let body = log_excerpt(response.text().await.unwrap_or_default());
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
    if status.is_server_error() || status.as_u16() == 429 {
        // Same rationale as mal_api.rs::search_by_title — bail on real
        // upstream trouble so merged_search can flag `degraded` and the
        // client routes into transient/retry UI instead of "no results".
        let body = log_excerpt(response.text().await.unwrap_or_default());
        tracing::warn!(%status, body, "mangadex: 5xx/429 on search");
        anyhow::bail!("MangaDex search non-success status: {status}");
    }
    if !status.is_success() {
        let body = log_excerpt(response.text().await.unwrap_or_default());
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

/// MangaDex answered 429. Carried as its own error so a caller walking a
/// list can stop instead of reading it as one missing title.
#[derive(Debug)]
pub struct RateLimited;

impl std::fmt::Display for RateLimited {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("MangaDex rate limit reached")
    }
}

impl std::error::Error for RateLimited {}

/// The start of an upstream error body, for a log line. A whole body is
/// whatever the upstream chose to send — kilobytes of HTML from a proxy
/// in front of it, sometimes — written into the logs verbatim.
fn log_excerpt(body: String) -> String {
    const LIMIT: usize = 300;
    if body.chars().count() <= LIMIT {
        return body;
    }
    let mut cut: String = body.chars().take(LIMIT).collect();
    cut.push('…');
    cut
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "331deec0-fb1a-4680-9248-8a0fc55b5b07";
    const B: &str = "02f827bd-c817-4e80-b63f-94a44b2eb504";

    fn result(id: &str, mal_id: Option<i32>) -> MangadexResult {
        MangadexResult {
            mangadex_id: id.to_string(),
            mal_id,
            name: "x".into(),
            image_url: None,
            volumes: None,
            genres: Vec::new(),
            year: None,
            status: None,
            content_rating: None,
        }
    }

    #[test]
    fn only_an_exact_mal_link_matches() {
        let found = vec![result(B, Some(48)), result(A, Some(49865))];
        assert_eq!(link_match(&found, 49865), LinkMatch::One(A.into()));
        assert_eq!(link_match(&found, 1), LinkMatch::None);
        assert_eq!(link_match(&[result(A, None)], 49865), LinkMatch::None);
    }

    #[test]
    fn two_entries_for_one_mal_id_link_nothing() {
        let found = vec![result(A, Some(90125)), result(B, Some(90125))];
        assert_eq!(link_match(&found, 90125), LinkMatch::Several);
    }

    fn page(json: &str) -> MdMangaList {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn a_truncated_page_cannot_prove_uniqueness() {
        let entry = format!(r#"{{"id":"{A}","attributes":{{"title":{{"en":"t"}}}}}}"#);
        let whole = page(&format!(r#"{{"data":[{entry}],"total":1}}"#));
        assert_eq!(whole_page(whole).map(|r| r.len()), Some(1));
        let cut = page(&format!(r#"{{"data":[{entry}],"total":2}}"#));
        assert!(whole_page(cut).is_none());
        // No total in the answer: nothing to contradict the page.
        assert!(whole_page(page(&format!(r#"{{"data":[{entry}]}}"#))).is_some());
    }

    #[test]
    fn a_result_that_is_not_a_uuid_never_links() {
        assert_eq!(
            link_match(&[result("not-a-uuid", Some(7))], 7),
            LinkMatch::None
        );
    }

    #[test]
    fn the_second_search_uses_the_latin_part_of_a_mixed_title() {
        let part = |t| latin_title_part(t).as_deref().map(str::to_owned);
        assert_eq!(part("アオのハコ (Blue Box)").as_deref(), Some("Blue Box"));
        assert_eq!(
            part("ヒカルの碁 Hikaru no Go").as_deref(),
            Some("Hikaru no Go")
        );
        assert_eq!(
            part("Fullmetal Alchemist - 鋼の錬金術師").as_deref(),
            Some("Fullmetal Alchemist")
        );
        assert_eq!(part("Ajin"), None, "already Latin: nothing new to ask");
        assert_eq!(part("宝石の国"), None, "no Latin text to ask with");
    }
}
