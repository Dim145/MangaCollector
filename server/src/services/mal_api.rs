use std::time::Duration;

use anyhow::Context;
use serde::{Deserialize, Serialize};

use crate::services::cache::CacheStore;

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
}

/// MAL metadata rarely changes — a 24h TTL is a good balance between
/// freshness (new volumes announced) and cache efficiency.
const MAL_DETAILS_TTL: Duration = Duration::from_secs(24 * 3600);

pub async fn get_manga_from_mal(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    mal_id: i32,
) -> anyhow::Result<Option<MalMangaData>> {
    let cache_key = format!("mal:manga:{}", mal_id);

    // Cache lookup: on a hit we return immediately without touching Jikan.
    // `Option<MalMangaData>` serialization handles both the "found" case and
    // the "known-absent" case (JSON `null`).
    if let Some(cache) = cache {
        if let Some(cached) = cache.get::<Option<MalMangaData>>(&cache_key).await {
            return Ok(cached);
        }
    }

    let url = format!("https://api.jikan.moe/v4/manga/{}/full", mal_id);
    let response = client
        .get(&url)
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
