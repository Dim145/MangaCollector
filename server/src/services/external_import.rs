//! 外部輸入 · External import — fetch reading lists from MyAnimeList
//! (via Jikan), MangaDex (public list UUID), or AniList (GraphQL by
//! username), and transform them into our portable `ExportBundle`
//! format so the existing merge-import pipeline can apply them.
//!
//! Contract with the handlers:
//!   • Each `fetch_*` returns a fully-formed `ExportBundle` with
//!     `version = EXPORT_VERSION` and `source` set to the service name.
//!   • Series come with metadata only — `volumes_detail` and `coffrets`
//!     are empty. The user fills these after import via the normal UI.
//!   • Per-service status mapping: "completed" / "reading" sets
//!     `volumes_owned` = min(read_volumes, total_volumes) when
//!     available, otherwise 0.

use chrono::Utc;
use serde::Deserialize;

use crate::errors::AppError;
use crate::models::archive::{
    ExportBundle, ExportSeries, ExportUser, EXPORT_VERSION,
};

/// Hard cap to keep external imports sane and stay well inside rate
/// limits. Any list longer is truncated and the client is informed via
/// the preview (which reports `total_in_file`).
const MAX_ENTRIES: usize = 500;

/* ══════════════════════════════════════════════════════════════════
 *  MyAnimeList — via Jikan (unofficial REST gateway for MAL).
 *  Endpoint: GET /v4/users/{username}/mangalist?page={n}
 * ══════════════════════════════════════════════════════════════════ */

#[derive(Debug, Deserialize)]
struct JikanListResponse {
    data: Vec<JikanListEntry>,
    pagination: JikanPagination,
}

#[derive(Debug, Deserialize)]
struct JikanPagination {
    has_next_page: bool,
}

#[derive(Debug, Deserialize)]
struct JikanListEntry {
    manga: JikanManga,
    #[serde(default)]
    read_volumes: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct JikanManga {
    mal_id: i32,
    title: String,
    #[serde(default)]
    images: Option<JikanImages>,
    #[serde(default)]
    volumes: Option<i32>,
    #[serde(default)]
    genres: Option<Vec<JikanNamed>>,
    #[serde(default)]
    explicit_genres: Option<Vec<JikanNamed>>,
}

#[derive(Debug, Deserialize)]
struct JikanImages {
    #[serde(default)]
    jpg: Option<JikanImageUrls>,
}

#[derive(Debug, Deserialize)]
struct JikanImageUrls {
    #[serde(default)]
    image_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JikanNamed {
    name: String,
}

pub async fn fetch_mal_by_username(
    client: &reqwest::Client,
    username: &str,
) -> Result<ExportBundle, AppError> {
    let user = username.trim();
    if user.is_empty() {
        return Err(AppError::BadRequest("MAL username is empty.".into()));
    }
    // MAL / Jikan usernames are restricted to [A-Za-z0-9_-]. Validating
    // up-front means we can safely interpolate the raw string into the
    // URL without pulling a percent-encoder dep.
    if !is_safe_handle(user) {
        return Err(AppError::BadRequest(
            "Username contains invalid characters.".into(),
        ));
    }
    // Hard pagination ceiling. With 25 entries/page (Jikan default)
    // and our MAX_ENTRIES=500 cap, a legitimate user won't need more
    // than ~20 pages. Anything beyond is either a very pathological
    // MAL account or an attacker dragging us into extended outbound
    // traffic. Cap at 50 pages to give real users ample headroom.
    const MAX_PAGES: u32 = 50;
    let mut series: Vec<ExportSeries> = Vec::new();
    let mut page = 1_u32;
    loop {
        if series.len() >= MAX_ENTRIES {
            break;
        }
        if page > MAX_PAGES {
            tracing::warn!(
                username = user,
                pages = page - 1,
                "fetch_mal_by_username: hit MAX_PAGES ceiling, returning partial results"
            );
            break;
        }
        let url = format!(
            "https://api.jikan.moe/v4/users/{}/mangalist?page={}",
            user, page
        );
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| AppError::BadRequest(format!("MAL fetch failed: {e}")))?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(AppError::NotFound("MAL user not found".into()));
        }
        if !resp.status().is_success() {
            return Err(AppError::BadRequest(format!(
                "MAL returned {}",
                resp.status()
            )));
        }
        let body: JikanListResponse = resp
            .json()
            .await
            .map_err(|e| AppError::BadRequest(format!("MAL parse error: {e}")))?;

        for entry in body.data {
            if series.len() >= MAX_ENTRIES {
                break;
            }
            // `volumes` from Jikan/MAL is the published total. `None`
            // means MAL doesn't know (unfinished or metadata gap), in
            // which case the previous `unwrap_or(0)` forced the clamp
            // `r.min(0)` below → `owned = 0` regardless of what the
            // user actually read. Silently discarding the user's
            // progress at import time is a data-loss footgun.
            //
            // New behaviour: when total is unknown, trust the
            // `read_volumes` count the source shipped, only capping
            // negatives to zero. If MAL later publishes a total, the
            // user can re-run the import or edit the value manually.
            let total = entry.manga.volumes;
            let owned = match (entry.read_volumes, total) {
                (Some(r), Some(t)) => r.min(t).max(0),
                (Some(r), None) => r.max(0),
                (None, _) => 0,
            };
            let total = total.unwrap_or(0);
            let mut genres = Vec::new();
            if let Some(gs) = entry.manga.genres {
                for g in gs {
                    genres.push(g.name);
                }
            }
            if let Some(gs) = entry.manga.explicit_genres {
                for g in gs {
                    genres.push(g.name);
                }
            }
            let image = entry
                .manga
                .images
                .and_then(|i| i.jpg)
                .and_then(|j| j.image_url);
            series.push(ExportSeries {
                mal_id: Some(entry.manga.mal_id),
                mangadex_id: None,
                name: entry.manga.title,
                volumes: total,
                volumes_owned: owned,
                image_url_jpg: image,
                genres,
                volumes_detail: Vec::new(),
                coffrets: Vec::new(),
            });
        }

        if !body.pagination.has_next_page {
            break;
        }
        page += 1;
        // Jikan is generous but not free — pace to ~3 req/s ceiling.
        tokio::time::sleep(std::time::Duration::from_millis(350)).await;
    }
    Ok(wrap_bundle("MyAnimeList", series))
}

/* ══════════════════════════════════════════════════════════════════
 *  AniList — public GraphQL, no auth for public profiles.
 *  Endpoint: POST https://graphql.anilist.co
 * ══════════════════════════════════════════════════════════════════ */

const ANILIST_QUERY: &str = r#"
query ($userName: String) {
  MediaListCollection(userName: $userName, type: MANGA) {
    lists {
      entries {
        progressVolumes
        status
        media {
          id
          idMal
          title { romaji english native }
          coverImage { large }
          volumes
          genres
        }
      }
    }
  }
}
"#;

#[derive(Debug, Deserialize)]
struct AniListResponse {
    data: Option<AniListData>,
    #[serde(default)]
    errors: Option<Vec<AniListError>>,
}

#[derive(Debug, Deserialize)]
struct AniListError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct AniListData {
    #[serde(rename = "MediaListCollection")]
    media_list_collection: Option<AniListCollection>,
}

#[derive(Debug, Deserialize)]
struct AniListCollection {
    lists: Vec<AniListList>,
}

#[derive(Debug, Deserialize)]
struct AniListList {
    entries: Vec<AniListEntry>,
}

#[derive(Debug, Deserialize)]
struct AniListEntry {
    #[serde(default, rename = "progressVolumes")]
    progress_volumes: Option<i32>,
    #[serde(default)]
    status: Option<String>,
    media: AniListMedia,
}

#[derive(Debug, Deserialize)]
struct AniListMedia {
    #[serde(default, rename = "idMal")]
    id_mal: Option<i32>,
    title: AniListTitle,
    #[serde(default, rename = "coverImage")]
    cover_image: Option<AniListCover>,
    #[serde(default)]
    volumes: Option<i32>,
    #[serde(default)]
    genres: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct AniListTitle {
    #[serde(default)]
    romaji: Option<String>,
    #[serde(default)]
    english: Option<String>,
    #[serde(default)]
    native: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AniListCover {
    #[serde(default)]
    large: Option<String>,
}

pub async fn fetch_anilist_by_username(
    client: &reqwest::Client,
    username: &str,
) -> Result<ExportBundle, AppError> {
    let user = username.trim();
    if user.is_empty() {
        return Err(AppError::BadRequest("AniList username is empty.".into()));
    }
    if !is_safe_handle(user) {
        return Err(AppError::BadRequest(
            "Username contains invalid characters.".into(),
        ));
    }
    let body = serde_json::json!({
        "query": ANILIST_QUERY,
        "variables": { "userName": user },
    });
    let resp = client
        .post("https://graphql.anilist.co")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::BadRequest(format!("AniList fetch failed: {e}")))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::NotFound("AniList user not found".into()));
    }
    if !resp.status().is_success() {
        return Err(AppError::BadRequest(format!(
            "AniList returned {}",
            resp.status()
        )));
    }
    let parsed: AniListResponse = resp
        .json()
        .await
        .map_err(|e| AppError::BadRequest(format!("AniList parse error: {e}")))?;
    if let Some(errors) = parsed.errors {
        if !errors.is_empty() {
            let msg = errors
                .into_iter()
                .map(|e| e.message)
                .collect::<Vec<_>>()
                .join("; ");
            return Err(AppError::BadRequest(format!("AniList: {msg}")));
        }
    }
    let coll = parsed
        .data
        .and_then(|d| d.media_list_collection)
        .ok_or_else(|| AppError::NotFound("AniList user not found or private".into()))?;

    let mut series = Vec::new();
    for list in coll.lists {
        for entry in list.entries {
            if series.len() >= MAX_ENTRIES {
                break;
            }
            let name = entry
                .media
                .title
                .english
                .clone()
                .or(entry.media.title.romaji.clone())
                .or(entry.media.title.native.clone())
                .unwrap_or_else(|| "Untitled".into());
            // Same "volume total unknown" preservation as for the MAL
            // importer: when AniList doesn't publish a volume count
            // (`media.volumes` is null for ongoing series), trust the
            // user's reported `progress_volumes` instead of clamping
            // to zero. See the Jikan branch above for full rationale.
            let total = entry.media.volumes;
            let owned = match (entry.progress_volumes, total) {
                (Some(v), Some(t)) => v.min(t).max(0),
                (Some(v), None) => v.max(0),
                (None, _) => 0,
            };
            let total = total.unwrap_or(0);
            series.push(ExportSeries {
                mal_id: entry.media.id_mal,
                mangadex_id: None,
                name,
                volumes: total,
                volumes_owned: owned,
                image_url_jpg: entry
                    .media
                    .cover_image
                    .and_then(|c| c.large),
                genres: entry.media.genres,
                volumes_detail: Vec::new(),
                coffrets: Vec::new(),
            });
            // Status is informational for now; future versions could
            // use it to infer owned-all-volumes for "COMPLETED" status.
            let _ = entry.status;
        }
    }
    Ok(wrap_bundle("AniList", series))
}

/* ══════════════════════════════════════════════════════════════════
 *  MangaDex — public list (URL or UUID). The list endpoint gives us
 *  relationship refs; for each we fetch the manga metadata through
 *  the existing `mangadex_api::get_by_id` helper so cover-art and
 *  genre logic stay consistent with the rest of the app.
 * ══════════════════════════════════════════════════════════════════ */

#[derive(Debug, Deserialize)]
struct MdListResponse {
    data: MdListBody,
}

#[derive(Debug, Deserialize)]
struct MdListBody {
    #[serde(default)]
    relationships: Vec<MdListRelation>,
}

#[derive(Debug, Deserialize)]
struct MdListRelation {
    id: String,
    #[serde(rename = "type")]
    rel_type: String,
}

/// Input can be:
///   • A MangaDex list URL: `https://mangadex.org/list/{uuid}`
///   • Just the list UUID.
///   • A comma or newline-separated list of manga UUIDs (not a list).
/// We try list-lookup first; if that fails and the input tokens look
/// like UUIDs, we treat them as individual manga refs.
pub async fn fetch_mangadex_by_input(
    client: &reqwest::Client,
    input: &str,
) -> Result<ExportBundle, AppError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("Empty MangaDex input.".into()));
    }

    // Parse: extract UUIDs from whatever the user pasted. UUIDs are
    // 8-4-4-4-12 hex chars separated by hyphens.
    let tokens: Vec<String> = trimmed
        .split(|c: char| !c.is_ascii_hexdigit() && c != '-')
        .filter(|s| is_uuid(s))
        .map(|s| s.to_lowercase())
        .collect();

    // Strategy: if the input is a single UUID and appears to be a list
    // ID (list-lookup succeeds), expand to its members. Otherwise, try
    // each UUID as a manga ID directly.
    let mut manga_ids: Vec<String> = Vec::new();
    if tokens.len() == 1 {
        // Try list lookup first.
        let list_id = &tokens[0];
        // UUIDs are already URL-safe (hex + hyphens) — no percent-encoding needed.
        let url = format!(
            "https://api.mangadex.org/list/{}?includes[]=manga",
            list_id
        );
        let ua = concat!("MangaCollector/", env!("CARGO_PKG_VERSION"));
        let resp = client.get(&url).header("User-Agent", ua).send().await;
        if let Ok(r) = resp {
            if r.status().is_success() {
                if let Ok(body) = r.json::<MdListResponse>().await {
                    for rel in body.data.relationships {
                        if rel.rel_type == "manga" {
                            manga_ids.push(rel.id);
                        }
                    }
                }
            }
        }
        // Fallback: treat the single UUID as a manga ID.
        if manga_ids.is_empty() {
            manga_ids.push(list_id.clone());
        }
    } else {
        manga_ids = tokens;
    }

    if manga_ids.is_empty() {
        return Err(AppError::BadRequest(
            "No UUIDs detected. Paste a list URL, a list UUID, or several manga UUIDs.".into(),
        ));
    }
    manga_ids.truncate(MAX_ENTRIES);

    // For each UUID: fetch metadata via the existing MangaDex helper.
    // We pass cache=None to force a fresh lookup; an external-import is
    // infrequent enough that the TTL savings aren't worth surprising
    // users with stale names/covers.
    let mut series = Vec::new();
    for id in &manga_ids {
        match crate::services::mangadex_api::get_by_id(client, None, id).await {
            Ok(Some(m)) => {
                series.push(ExportSeries {
                    mal_id: m.mal_id,
                    mangadex_id: Some(m.mangadex_id.clone()),
                    name: m.name,
                    volumes: m.volumes.unwrap_or(0),
                    volumes_owned: 0,
                    image_url_jpg: m.image_url,
                    genres: m.genres,
                    volumes_detail: Vec::new(),
                    coffrets: Vec::new(),
                });
            }
            Ok(None) => { /* silently skip 404s — user may have pasted a dead UUID */ }
            Err(_) => { /* transient error, skip */ }
        }
        // MangaDex rate-limit: 5 req/s. 250ms between requests is safe.
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    Ok(wrap_bundle("MangaDex", series))
}

fn is_uuid(s: &str) -> bool {
    // 8-4-4-4-12 hex
    let s = s.trim().to_lowercase();
    if s.len() != 36 {
        return false;
    }
    let bytes = s.as_bytes();
    for (i, b) in bytes.iter().enumerate() {
        let expected_hyphen = i == 8 || i == 13 || i == 18 || i == 23;
        if expected_hyphen {
            if *b != b'-' {
                return false;
            }
        } else if !b.is_ascii_hexdigit() {
            return false;
        }
    }
    true
}

/// MAL / AniList usernames are documented to use `[A-Za-z0-9_-]` with
/// length 2..=16. We allow a wider 2..=32 window to be forgiving for
/// edge cases but reject anything that could break a URL path.
fn is_safe_handle(s: &str) -> bool {
    let len = s.chars().count();
    if !(2..=32).contains(&len) {
        return false;
    }
    s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/* ══════════════════════════════════════════════════════════════════
 *  Yamtrack — CSV upload.
 *
 *  Yamtrack's built-in `/export/csv` endpoint dumps every tracked item
 *  (tv / movies / manga / …) into a single file with `QUOTE_ALL`
 *  quoting. We filter rows with media_type == "manga" and map them
 *  into ExportSeries. The `source` column tells us whether the
 *  media_id is a MAL id, a MangaUpdates id, or a manual custom entry.
 *
 *  Header (verbatim from `integrations/exports.py::generate_rows`):
 *    media_id, source, media_type, title, image, season_number,
 *    episode_number, score, progress, status, start_date, end_date,
 *    notes, created_at, progressed_at
 *
 *  What we import per row:
 *    mal_id       ← parsed media_id when source == "mal", else None
 *                   (None → apply_import_merge mints a custom negative id)
 *    name         ← title
 *    image_url    ← image (may be empty)
 *    volumes      ← 0 (not in CSV — user can "sync from MAL" after)
 *    volumes_owned ← 0 (same — we don't infer from "Completed" since the
 *                       CSV doesn't carry the total volumes)
 *    genres       ← empty (not in CSV)
 *
 *  What we drop on purpose:
 *    score, notes, start_date, end_date — not modelled on our side yet.
 *    status — informational only; no per-volume detail to seed.
 */

pub fn parse_yamtrack_csv(csv_text: &str) -> Result<ExportBundle, AppError> {
    if csv_text.trim().is_empty() {
        return Err(AppError::BadRequest("Empty CSV.".into()));
    }
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(csv_text.as_bytes());

    // Index the headers so we're tolerant to column reordering (Yamtrack
    // builds them dynamically from model fields — order is stable today
    // but not contractually guaranteed).
    let headers = rdr
        .headers()
        .map_err(|e| AppError::BadRequest(format!("CSV header error: {e}")))?
        .clone();
    let col = |name: &str| headers.iter().position(|h| h == name);
    let c_media_id = col("media_id");
    let c_source = col("source");
    let c_media_type = col("media_type");
    let c_title = col("title");
    let c_image = col("image");
    if c_media_id.is_none()
        || c_source.is_none()
        || c_media_type.is_none()
        || c_title.is_none()
    {
        return Err(AppError::BadRequest(
            "Missing expected Yamtrack columns (media_id/source/media_type/title)."
                .into(),
        ));
    }

    let mut series: Vec<ExportSeries> = Vec::new();
    let mut seen_ids: std::collections::HashSet<(String, String)> =
        std::collections::HashSet::new();
    for record in rdr.records() {
        let row = match record {
            Ok(r) => r,
            Err(_) => continue,
        };
        if series.len() >= MAX_ENTRIES {
            break;
        }
        let media_type = row
            .get(c_media_type.unwrap())
            .unwrap_or("")
            .trim();
        if media_type != "manga" {
            continue;
        }
        let source = row
            .get(c_source.unwrap())
            .unwrap_or("")
            .trim()
            .to_lowercase();
        let media_id = row.get(c_media_id.unwrap()).unwrap_or("").trim();
        let title = row
            .get(c_title.unwrap())
            .unwrap_or("")
            .trim()
            .to_string();
        if title.is_empty() {
            continue;
        }
        // Dedupe within the file itself — Yamtrack can emit the same item
        // twice if the user changed source halfway through.
        let key = (source.clone(), media_id.to_string());
        if !seen_ids.insert(key) {
            continue;
        }

        let mal_id = if source == "mal" {
            media_id.parse::<i32>().ok().filter(|n| *n > 0)
        } else {
            None
        };
        let image = row
            .get(c_image.unwrap_or(usize::MAX))
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from);

        series.push(ExportSeries {
            mal_id,
            mangadex_id: None,
            name: title,
            volumes: 0,
            volumes_owned: 0,
            image_url_jpg: image,
            genres: Vec::new(),
            volumes_detail: Vec::new(),
            coffrets: Vec::new(),
        });
    }
    Ok(wrap_bundle("Yamtrack", series))
}

/* ══════════════════════════════════════════════════════════════════ */

fn wrap_bundle(source: &str, library: Vec<ExportSeries>) -> ExportBundle {
    ExportBundle {
        version: EXPORT_VERSION,
        exported_at: Utc::now(),
        source: format!("MangaCollector external import · {source}"),
        user: ExportUser { name: None },
        settings: None,
        library,
    }
}
