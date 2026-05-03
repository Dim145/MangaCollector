use std::time::Duration;

use anyhow::Context;
use serde::{Deserialize, Serialize};

use crate::services::cache::CacheStore;
use crate::util::url::build_url;

/// Per-call timeout for Jikan requests served on a user-facing path
/// (manga detail / pictures look-ups invoked from a request handler).
/// The shared HTTP client has a 30s safety net but 30s on a user-
/// facing endpoint is far too long; we tighten to 8s here so a Jikan
/// blip surfaces quickly with a fallback rather than holding a
/// connection.
const USER_FACING_FETCH_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MalImages {
    pub jpg: Option<MalImageVariants>,
    pub webp: Option<MalImageVariants>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MalImageVariants {
    pub image_url: Option<String>,
    pub small_image_url: Option<String>,
    pub large_image_url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MalTitle {
    #[serde(rename = "type")]
    pub title_type: String,
    pub title: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MalGenre {
    #[serde(rename = "type")]
    pub genre_type: String,
    pub name: String,
}

/// 作家 · MAL author entry — shipped under `authors` on /full responses.
///
/// Multiple authors are common (writer + artist on shōnen, or
/// `"Story by" / "Art by"` on collaborations); we collect them all
/// but only the first non-empty `name` becomes the canonical
/// `author` we persist. Both `mal_id` and `url` ride along so the
/// caller can resolve the author detail page (`/api/authors/{id}`)
/// and link out to MAL.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MalAuthor {
    #[serde(default)]
    pub mal_id: Option<i32>,
    pub name: String,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MalMangaData {
    pub mal_id: i32,
    pub images: Option<MalImages>,
    pub titles: Option<Vec<MalTitle>>,
    pub title: Option<String>,
    pub volumes: Option<i32>,
    pub genres: Option<Vec<MalGenre>>,
    pub explicit_genres: Option<Vec<MalGenre>>,
    pub demographics: Option<Vec<MalGenre>>,
    /// `authors` from /v4/manga/{id}/full — array of name + role
    /// pairs. Always Some on real responses, but defensive Option so
    /// a flaky upstream doesn't break the deserializer.
    #[serde(default)]
    pub authors: Option<Vec<MalAuthor>>,
}

/// MAL metadata rarely changes — a 24h TTL is a good balance between
/// freshness (new volumes announced) and cache efficiency.
const MAL_DETAILS_TTL: Duration = Duration::from_secs(24 * 3600);
/// Search results — 15 minutes. Matches the MangaDex side so merged-search
/// entries refresh together.
const MAL_SEARCH_TTL: Duration = Duration::from_secs(15 * 60);

pub async fn get_manga_from_mal(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    mal_id: i32,
) -> anyhow::Result<Option<MalMangaData>> {
    let cache_key = format!("mal:manga:{}", mal_id);

    // Cache lookup: on a hit we return immediately without touching Jikan.
    // `Option<MalMangaData>` serialization handles both the "found" case and
    // the "known-absent" case (JSON `null`).
    if let Some(cache) = cache
        && let Some(cached) = cache.get::<Option<MalMangaData>>(&cache_key).await {
            return Ok(cached);
        }

    // 安 · URL built through `Url::path_segments_mut` so CodeQL's
    // `rust/request-forgery` taint analysis sees the sanitizer.
    // `mal_id` is `i32` — `Display` only emits digits, so this is
    // safe in practice; the builder is defence in depth (and would
    // remain correct if the param ever became user-controlled text).
    let url = build_url(
        "https://api.jikan.moe/v4/manga",
        &[&mal_id.to_string(), "full"],
    )
    .map_err(|e| anyhow::anyhow!("MAL URL build: {e}"))?;
    let response = client
        .get(url)
        .timeout(USER_FACING_FETCH_TIMEOUT)
        .send()
        .await
        .context("Failed to reach MAL API")?;

    if !response.status().is_success() {
        // 4xx/5xx are not cached — we want to retry next time, especially
        // for transient Jikan rate-limit errors (429).
        return Ok(None);
    }

    let body: serde_json::Value = response
        .json()
        .await
        .context("Failed to parse MAL response")?;
    let data: Option<MalMangaData> = serde_json::from_value(body["data"].clone()).ok();

    if let Some(cache) = cache {
        cache.set(&cache_key, &data, MAL_DETAILS_TTL).await;
    }

    Ok(data)
}

/// Pictures for a MAL manga — usually 3–8 alternate covers / key-visuals per
/// popular series. 7-day TTL: these rarely change post-release.
const MAL_PICTURES_TTL: Duration = Duration::from_secs(7 * 24 * 3600);

/// Fetch the list of alternate cover images MAL ships for this manga via
/// Jikan's `/manga/{id}/pictures` endpoint. Returns large_image_url
/// preferentially; falls back to image_url when large is missing.
/// Best-effort: empty Vec on any failure so the caller can fall through.
pub async fn get_pictures(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    mal_id: i32,
) -> anyhow::Result<Vec<String>> {
    let cache_key = format!("mal:pictures:{}", mal_id);
    if let Some(cache) = cache
        && let Some(cached) = cache.get::<Vec<String>>(&cache_key).await {
            return Ok(cached);
        }

    let url = build_url(
        "https://api.jikan.moe/v4/manga",
        &[&mal_id.to_string(), "pictures"],
    )
    .map_err(|e| anyhow::anyhow!("MAL pictures URL build: {e}"))?;
    let response = client
        .get(url)
        .timeout(USER_FACING_FETCH_TIMEOUT)
        .send()
        .await
        .context("Failed to reach MAL pictures endpoint")?;
    if !response.status().is_success() {
        return Ok(Vec::new());
    }

    #[derive(Deserialize)]
    struct PicturesPayload {
        #[serde(default)]
        data: Vec<MalImages>,
    }

    let parsed: PicturesPayload = response
        .json()
        .await
        .context("Failed to parse MAL pictures response")?;

    let out: Vec<String> = parsed
        .data
        .into_iter()
        .filter_map(|imgs| {
            imgs.jpg.and_then(|j| j.large_image_url.or(j.image_url))
        })
        .collect();

    if let Some(cache) = cache {
        cache.set(&cache_key, &out, MAL_PICTURES_TTL).await;
    }
    Ok(out)
}

/// Shape returned by `search_by_title` — subset of `MalMangaData` shaped for
/// the unified search UI. MangaDex has an equivalent `MangadexResult`; both
/// are merged by `services::external`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MalSearchResult {
    pub mal_id: i32,
    pub name: String,
    pub image_url: Option<String>,
    pub volumes: Option<i32>,
    pub genres: Vec<String>,
    pub score: Option<f64>,
}

#[derive(Deserialize)]
struct MalSearchRaw {
    mal_id: i32,
    title: Option<String>,
    titles: Option<Vec<MalTitle>>,
    images: Option<MalImages>,
    volumes: Option<i32>,
    score: Option<f64>,
    genres: Option<Vec<MalGenre>>,
    explicit_genres: Option<Vec<MalGenre>>,
    demographics: Option<Vec<MalGenre>>,
}

/// Search Jikan by free-text title. Returns up to 10 results, cached 15 min.
pub async fn search_by_title(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    query: &str,
) -> anyhow::Result<Vec<MalSearchResult>> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let cache_key = format!("mal:search:{}", trimmed.to_lowercase());
    if let Some(cache) = cache
        && let Some(cached) = cache.get::<Vec<MalSearchResult>>(&cache_key).await {
            return Ok(cached);
        }

    let response = client
        .get("https://api.jikan.moe/v4/manga")
        .query(&[("q", trimmed), ("limit", "10")])
        .send()
        .await
        .context("Failed to reach MAL API")?;

    if !response.status().is_success() {
        return Ok(Vec::new());
    }

    let body: serde_json::Value = response
        .json()
        .await
        .context("Failed to parse MAL search response")?;
    let raw: Vec<MalSearchRaw> =
        serde_json::from_value(body["data"].clone()).unwrap_or_default();

    let results: Vec<MalSearchResult> = raw
        .into_iter()
        .map(|r| {
            let name = r
                .titles
                .as_ref()
                .and_then(|ts| ts.iter().find(|t| t.title_type == "Default"))
                .map(|t| t.title.clone())
                .or_else(|| r.title.clone())
                .unwrap_or_default();

            let image_url = r
                .images
                .as_ref()
                .and_then(|i| i.jpg.as_ref())
                .and_then(|j| j.large_image_url.clone().or(j.image_url.clone()));

            let genres: Vec<String> = r
                .genres
                .iter()
                .flatten()
                .chain(r.explicit_genres.iter().flatten())
                .chain(r.demographics.iter().flatten())
                .filter(|g| g.genre_type == "manga")
                .map(|g| g.name.clone())
                .collect();

            MalSearchResult {
                mal_id: r.mal_id,
                name,
                image_url,
                volumes: r.volumes,
                genres,
                score: r.score,
            }
        })
        .collect();

    if let Some(cache) = cache {
        cache.set(&cache_key, &results, MAL_SEARCH_TTL).await;
    }
    Ok(results)
}
