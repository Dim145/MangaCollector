use anyhow::Context;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct MalImages {
    pub jpg: Option<MalImageVariants>,
    pub webp: Option<MalImageVariants>,
}

#[derive(Debug, Deserialize)]
pub struct MalImageVariants {
    pub image_url: Option<String>,
    pub small_image_url: Option<String>,
    pub large_image_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MalTitle {
    #[serde(rename = "type")]
    pub title_type: String,
    pub title: String,
}

#[derive(Debug, Deserialize)]
pub struct MalGenre {
    #[serde(rename = "type")]
    pub genre_type: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
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

pub async fn get_manga_from_mal(
    client: &reqwest::Client,
    mal_id: i32,
) -> anyhow::Result<Option<MalMangaData>> {
    let url = format!("https://api.jikan.moe/v4/manga/{}/full", mal_id);
    let response = client
        .get(&url)
        .send()
        .await
        .context("Failed to reach MAL API")?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let body: serde_json::Value = response.json().await.context("Failed to parse MAL response")?;
    let data = serde_json::from_value(body["data"].clone()).ok();
    Ok(data)
}
