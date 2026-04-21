use std::time::Duration;

use anyhow::Context;
use serde::Deserialize;

use crate::services::cache::CacheStore;

/// Positive hits (cover found) are rock-stable on MangaDex — 7 days is safe.
const MANGADEX_HIT_TTL: Duration = Duration::from_secs(7 * 24 * 3600);
/// Negative hits (series absent) get a shorter TTL: new manga might be added
/// to MangaDex later, so we re-check every 24h.
const MANGADEX_MISS_TTL: Duration = Duration::from_secs(24 * 3600);

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
    links: Option<MdLinks>,
}

#[derive(Deserialize, Default)]
struct MdLinks {
    /// MAL ID as a string (e.g. "1234") — MangaDex stores it stringly.
    #[serde(default)]
    mal: Option<String>,
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

/// Search MangaDex by title hint, then cross-reference the MAL id via
/// `attributes.links.mal` to make sure we match the right series. Returns a
/// direct uploads.mangadex.org URL for the preferred cover, or `None` if the
/// series isn't on MangaDex or the lookup fails.
///
/// Rate-limit friendly: MangaDex allows ~5 req/s globally per IP, we issue
/// 1 request per adult-tagged add.
///
/// Best-effort: any error (network, 404, parsing) resolves to `Ok(None)` so
/// the caller can fall back to the MAL cover silently.
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

    // Cache hit: both "found" and "known-absent" are cached (as JSON value
    // and JSON `null` respectively), so we only hit MangaDex on true misses.
    if let Some(cache) = cache {
        if let Some(cached) = cache.get::<Option<String>>(&cache_key).await {
            return Ok(cached);
        }
    }

    // MangaDex returns nothing by default for `erotica` / `pornographic` unless
    // we opt in via contentRating[]. Since the whole point is the uncensored
    // cover for adult series, we explicitly request all 4 ratings.
    let query = [
        ("title", title_hint),
        ("limit", "10"),
        ("includes[]", "cover_art"),
        ("contentRating[]", "safe"),
        ("contentRating[]", "suggestive"),
        ("contentRating[]", "erotica"),
        ("contentRating[]", "pornographic"),
        ("order[relevance]", "desc"),
    ];

    // MangaDex enforces a User-Agent policy: requests from the default
    // reqwest UA are rejected with HTTP 400. Setting a meaningful UA with
    // the app name + version fixes it and also helps them identify traffic.
    let response = client
        .get("https://api.mangadex.org/manga")
        .header(
            "User-Agent",
            concat!("MangaCollector/", env!("CARGO_PKG_VERSION")),
        )
        .query(&query)
        .send()
        .await
        .context("Failed to reach MangaDex API")?;

    let status = response.status();
    if !status.is_success() {
        // Surface the error body for diagnostics — MangaDex returns a JSON
        // `errors` array explaining what was wrong. We don't cache because
        // 4xx/5xx are often transient (rate-limit, outage).
        let body = response.text().await.unwrap_or_default();
        tracing::warn!(mal_id, %status, body, "mangadex: non-2xx response");
        return Ok(None);
    }

    let parsed: MdMangaList = response
        .json()
        .await
        .context("Failed to parse MangaDex response")?;

    let mal_str = mal_id.to_string();
    let mut found: Option<String> = None;

    for entry in parsed.data {
        let matches_mal = entry
            .attributes
            .links
            .as_ref()
            .and_then(|l| l.mal.as_deref())
            .map(|v| v == mal_str)
            .unwrap_or(false);

        if !matches_mal {
            continue;
        }

        // Pull filename from the included `cover_art` relationship.
        let cover_file = entry
            .relationships
            .iter()
            .find(|r| r.rel_type == "cover_art")
            .and_then(|r| r.attributes.as_ref())
            .and_then(|a| a.file_name.as_deref());

        if let Some(file) = cover_file {
            found = Some(format!(
                "https://uploads.mangadex.org/covers/{}/{}",
                entry.id, file
            ));
            break;
        }
    }

    // Cache the result (positive OR negative) so repeat adds of the same
    // adult series don't re-hit MangaDex for 7 days / 24h respectively.
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
