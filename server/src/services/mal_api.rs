//! 源 · Where MyAnimeList data comes from.
//!
//! Two upstreams answer for MyAnimeList, and the operator chooses:
//!
//! * **Jikan**, the unofficial REST gateway, at `JIKAN_API_URL`
//!   (default `https://api.jikan.moe/v4`). The public instance has been
//!   unreliable — long stretches where every call hangs until the
//!   timeout — and mirrors exist, so the base is no longer hard-coded.
//! * **The official MyAnimeList API v2**, used when `MAL_CLIENT_ID` is
//!   set and not empty. A client id is all the public endpoints need
//!   (search, a manga's details, a public list): no secret, no user
//!   token. It is sent as `X-MAL-CLIENT-ID` and never logged.
//!
//! With a client id, the official API is asked first for everything it
//! can answer, and Jikan only when it *failed* — unreachable, 5xx, 429,
//! a refused id. A 404 is an answer, not a failure: it is not retried
//! elsewhere. What the official API cannot answer at all — an author's
//! page, a manga's characters — still goes to Jikan.
//!
//! The official answers are reshaped into the Jikan-shaped structs the
//! rest of the server already reads (`MalMangaData`, `MalSearchResult`),
//! so no caller knows which upstream it got. The one real difference is
//! the genres: the official API returns MAL's genres, explicit genres,
//! themes and demographics in one list, where Jikan splits them and this
//! app keeps all but the themes. `split_genres` sorts them back by name.
//!
//! The choice is process-wide, set once at startup by `configure`;
//! everything here reads it through `upstream()`, which is why no
//! caller's signature had to change. Tests build an `Upstream` of their
//! own and call the `*_with` functions directly.

use std::sync::OnceLock;
use std::time::Duration;

use anyhow::Context;
use reqwest::Url;
use reqwest::header::HeaderValue;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::services::cache::CacheStore;
use crate::services::jikan_compat;

/// Per-call timeout for MyAnimeList requests served on a user-facing
/// path (search, manga detail, pictures, recommendations). The shared
/// HTTP client has a 30s safety net but 30s on a user-facing endpoint
/// is far too long; we tighten to 8s here so an upstream blip surfaces
/// quickly with a fallback rather than holding a connection.
const USER_FACING_FETCH_TIMEOUT: Duration = Duration::from_secs(8);

/// The public Jikan instance, used when `JIKAN_API_URL` is unset.
pub const DEFAULT_JIKAN_BASE: &str = "https://api.jikan.moe/v4";
const MAL_OFFICIAL_BASE: &str = "https://api.myanimelist.net/v2";
const MAL_CLIENT_ID_HEADER: &str = "X-MAL-CLIENT-ID";

/* ══════════════════════════════════════════════════════════════════
 *  Configuration
 * ══════════════════════════════════════════════════════════════════ */

/// The two upstreams, as configured.
#[derive(Clone)]
pub struct Upstream {
    jikan: Url,
    official: Option<Official>,
}

#[derive(Clone)]
struct Official {
    base: Url,
    /// Marked sensitive, so it is never printed by `Debug`.
    client_id: HeaderValue,
}

impl std::fmt::Debug for Upstream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Upstream")
            .field("jikan", &self.jikan.as_str())
            .field("official_api", &self.official.is_some())
            .finish()
    }
}

impl Default for Upstream {
    fn default() -> Self {
        Self {
            jikan: default_jikan(),
            official: None,
        }
    }
}

fn default_jikan() -> Url {
    Url::parse(DEFAULT_JIKAN_BASE).expect("DEFAULT_JIKAN_BASE is a valid URL")
}

impl Upstream {
    /// From the raw `JIKAN_API_URL` and `MAL_CLIENT_ID` values. A value
    /// that cannot be used is reported and replaced by the default —
    /// a typo in an optional integration should not stop the server.
    pub fn from_settings(jikan_api_url: Option<&str>, mal_client_id: Option<&str>) -> Self {
        let jikan = match jikan_api_url.map(str::trim).filter(|s| !s.is_empty()) {
            None => default_jikan(),
            Some(raw) => match parse_jikan_base(raw) {
                Ok(url) => url,
                Err(reason) => {
                    tracing::warn!(reason, "JIKAN_API_URL ignored; using {DEFAULT_JIKAN_BASE}");
                    default_jikan()
                }
            },
        };
        let official = mal_client_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .and_then(|id| match HeaderValue::from_str(id) {
                Ok(mut client_id) => {
                    client_id.set_sensitive(true);
                    Some(Official {
                        base: Url::parse(MAL_OFFICIAL_BASE)
                            .expect("MAL_OFFICIAL_BASE is a valid URL"),
                        client_id,
                    })
                }
                Err(_) => {
                    tracing::warn!(
                        "MAL_CLIENT_ID is not a valid header value; the official \
                         MyAnimeList API stays off"
                    );
                    None
                }
            });
        Self { jikan, official }
    }

    /// Whether the official MyAnimeList API is in use.
    pub fn uses_official_api(&self) -> bool {
        self.official.is_some()
    }

    /// The Jikan base, for the startup log.
    pub fn jikan_base(&self) -> &str {
        self.jikan.as_str()
    }

    /// A Jikan URL: the configured base, then `segments`, each pushed
    /// through `path_segments_mut` so a segment can never re-anchor the
    /// path or reach the authority.
    pub(crate) fn jikan_url(&self, segments: &[&str]) -> Url {
        join(&self.jikan, segments)
    }

    #[cfg(test)]
    fn for_tests(jikan: &str, official: Option<(&str, &str)>) -> Self {
        Self {
            jikan: parse_jikan_base(jikan).expect("test Jikan base"),
            official: official.map(|(base, id)| Official {
                base: Url::parse(base).expect("test MAL base"),
                client_id: HeaderValue::from_str(id).expect("test client id"),
            }),
        }
    }
}

fn join(base: &Url, segments: &[&str]) -> Url {
    let mut url = base.clone();
    if let Ok(mut path) = url.path_segments_mut() {
        path.pop_if_empty();
        for segment in segments {
            path.push(segment);
        }
    }
    url
}

/// Validate a Jikan base: an `http(s)` URL with a host, and nothing a
/// path is later appended to could misread — no query, no fragment, no
/// credentials (which would also end up in the startup log).
fn parse_jikan_base(raw: &str) -> Result<Url, &'static str> {
    let mut url = Url::parse(raw.trim()).map_err(|_| "not a URL")?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("the scheme must be http or https");
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err("the URL has no host");
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("the URL must not carry a query or a fragment");
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("the URL must not carry credentials");
    }
    if let Ok(mut path) = url.path_segments_mut() {
        path.pop_if_empty();
    }
    Ok(url)
}

static UPSTREAM: OnceLock<Upstream> = OnceLock::new();

/// Set the upstreams for the life of the process. Called once, from
/// `main`, before the router is built.
pub fn configure(upstream: Upstream) {
    tracing::info!(
        jikan = upstream.jikan_base(),
        official_mal_api = upstream.uses_official_api(),
        "MyAnimeList sources"
    );
    if UPSTREAM.set(upstream).is_err() {
        tracing::warn!("MyAnimeList sources configured twice; keeping the first");
    }
}

/// The configured upstreams — the public Jikan alone when `configure`
/// was never called.
pub fn upstream() -> &'static Upstream {
    UPSTREAM.get_or_init(Upstream::default)
}

/* ══════════════════════════════════════════════════════════════════
 *  The official API
 * ══════════════════════════════════════════════════════════════════ */

/// What an upstream answered, when it answered.
enum Answer<T> {
    Found(T),
    /// 404: the thing does not exist there. Authoritative — not retried
    /// on the other upstream.
    Missing,
}

/// One GET against the official API. `Err` is "did not answer"
/// (unreachable, refused, rate-limited, unreadable) and is what makes a
/// caller fall back to Jikan.
async fn official_json<T: DeserializeOwned>(
    client: &reqwest::Client,
    official: &Official,
    segments: &[&str],
    query: &[(&str, &str)],
) -> anyhow::Result<Answer<T>> {
    let response = client
        .get(join(&official.base, segments))
        .query(query)
        .header(MAL_CLIENT_ID_HEADER, official.client_id.clone())
        .timeout(USER_FACING_FETCH_TIMEOUT)
        .send()
        .await
        .context("MyAnimeList API unreachable")?;
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(Answer::Missing);
    }
    if !status.is_success() {
        return Err(official_failure(response).await);
    }
    let body = response
        .json::<T>()
        .await
        .context("MyAnimeList API answer unreadable")?;
    Ok(Answer::Found(body))
}

/// A failed answer, with MyAnimeList's own reason when it gave one —
/// `400 Bad Request: Invalid client id` tells the operator what to fix
/// where a bare status does not. Bounded: an error page is not read
/// whole, and only the `message` field is kept.
async fn official_failure(response: reqwest::Response) -> anyhow::Error {
    #[derive(Deserialize)]
    struct Reason {
        #[serde(default)]
        message: Option<String>,
    }
    let status = response.status();
    let reason = response
        .bytes()
        .await
        .ok()
        .filter(|b| b.len() <= 4096)
        .and_then(|b| serde_json::from_slice::<Reason>(&b).ok())
        .and_then(|r| non_empty(r.message))
        .map(|m| m.chars().take(200).collect::<String>());
    match reason {
        Some(reason) => anyhow::anyhow!("MyAnimeList API answered {status}: {reason}"),
        None => anyhow::anyhow!("MyAnimeList API answered {status}"),
    }
}

#[derive(Debug, Deserialize, Default)]
struct OfficialPicture {
    #[serde(default)]
    medium: Option<String>,
    #[serde(default)]
    large: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct OfficialAltTitles {
    #[serde(default)]
    synonyms: Vec<String>,
    #[serde(default)]
    en: Option<String>,
    #[serde(default)]
    ja: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OfficialGenre {
    pub(crate) name: String,
}

#[derive(Debug, Deserialize)]
struct OfficialAuthor {
    node: OfficialPerson,
}

#[derive(Debug, Deserialize)]
struct OfficialPerson {
    #[serde(default)]
    id: Option<i32>,
    #[serde(default)]
    first_name: Option<String>,
    #[serde(default)]
    last_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OfficialRecommendation {
    node: OfficialManga,
    #[serde(default)]
    num_recommendations: Option<i32>,
}

/// A manga as the official API ships it. Every field but `id` depends on
/// what `fields=` asked for, hence the defaults.
#[derive(Debug, Deserialize)]
struct OfficialManga {
    id: i32,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    main_picture: Option<OfficialPicture>,
    #[serde(default)]
    alternative_titles: Option<OfficialAltTitles>,
    /// 0 when MAL does not know the total yet.
    #[serde(default)]
    num_volumes: Option<i32>,
    #[serde(default)]
    mean: Option<f64>,
    #[serde(default)]
    genres: Vec<OfficialGenre>,
    #[serde(default)]
    authors: Vec<OfficialAuthor>,
    #[serde(default)]
    pictures: Vec<OfficialPicture>,
    #[serde(default)]
    recommendations: Vec<OfficialRecommendation>,
}

#[derive(Debug, Deserialize)]
struct OfficialNode<T> {
    node: T,
}

#[derive(Debug, Deserialize)]
struct OfficialPage<T> {
    data: Vec<T>,
}

const DETAIL_FIELDS: &str =
    "id,title,main_picture,alternative_titles,num_volumes,genres,authors{first_name,last_name}";
const SEARCH_FIELDS: &str = "id,title,main_picture,alternative_titles,num_volumes,mean,genres";

/// MAL's taxonomy as Jikan splits it. The official API returns these,
/// MAL's themes ("School", "Isekai"…) among them, in a single `genres`
/// list; this app has always kept genres, explicit genres and
/// demographics and left the themes out, so a series must not gain a
/// dozen tags because it came through the other upstream.
const MAL_GENRES: &[&str] = &[
    "Action",
    "Adventure",
    "Avant Garde",
    "Award Winning",
    "Boys Love",
    "Comedy",
    "Drama",
    "Fantasy",
    "Girls Love",
    "Gourmet",
    "Horror",
    "Mystery",
    "Romance",
    "Sci-Fi",
    "Slice of Life",
    "Sports",
    "Supernatural",
    "Suspense",
];
const MAL_EXPLICIT_GENRES: &[&str] = &["Ecchi", "Erotica", "Hentai"];
const MAL_DEMOGRAPHICS: &[&str] = &["Josei", "Kids", "Seinen", "Shoujo", "Shounen"];

/// The official API's single list, sorted back into Jikan's groups:
/// `(genres, explicit genres, demographics)`. Themes are dropped.
pub(crate) fn split_genres(list: &[OfficialGenre]) -> (Vec<String>, Vec<String>, Vec<String>) {
    let mut genres = Vec::new();
    let mut explicit = Vec::new();
    let mut demographics = Vec::new();
    for g in list {
        let name = g.name.trim();
        if MAL_GENRES.contains(&name) {
            genres.push(name.to_string());
        } else if MAL_EXPLICIT_GENRES.contains(&name) {
            explicit.push(name.to_string());
        } else if MAL_DEMOGRAPHICS.contains(&name) {
            demographics.push(name.to_string());
        }
    }
    (genres, explicit, demographics)
}

fn manga_genres(names: Vec<String>) -> Option<Vec<MalGenre>> {
    Some(
        names
            .into_iter()
            .map(|name| MalGenre {
                genre_type: "manga".into(),
                name,
            })
            .collect(),
    )
}

/// Jikan's `images` from the official `main_picture`. MAL serves the
/// same two files to both: `medium` is Jikan's `image_url`, `large` its
/// `large_image_url`.
fn images_from(picture: Option<OfficialPicture>) -> Option<MalImages> {
    let picture = picture?;
    let large = picture.large.clone().or_else(|| picture.medium.clone());
    Some(MalImages {
        jpg: Some(MalImageVariants {
            image_url: picture.medium.or_else(|| large.clone()),
            small_image_url: None,
            large_image_url: large,
        }),
        webp: None,
    })
}

fn non_empty(text: Option<String>) -> Option<String> {
    text.map(|t| t.trim().to_string()).filter(|t| !t.is_empty())
}

/// An author's name the way Jikan writes it — "Family, Given" — which is
/// what `library::flip_author_name` expects to undo.
fn jikan_style_name(person: &OfficialPerson) -> String {
    let first = person.first_name.as_deref().map(str::trim).unwrap_or("");
    let last = person.last_name.as_deref().map(str::trim).unwrap_or("");
    match (last.is_empty(), first.is_empty()) {
        (false, false) => format!("{last}, {first}"),
        (false, true) => last.to_string(),
        (true, false) => first.to_string(),
        (true, true) => String::new(),
    }
}

fn from_official(manga: OfficialManga) -> MalMangaData {
    let (genres, explicit, demographics) = split_genres(&manga.genres);
    let alt = manga.alternative_titles.unwrap_or_default();
    let title = non_empty(manga.title);
    let mut titles = Vec::new();
    if let Some(t) = &title {
        titles.push(MalTitle {
            title_type: "Default".into(),
            title: t.clone(),
        });
    }
    for synonym in alt.synonyms {
        if let Some(t) = non_empty(Some(synonym)) {
            titles.push(MalTitle {
                title_type: "Synonym".into(),
                title: t,
            });
        }
    }
    if let Some(t) = non_empty(alt.ja) {
        titles.push(MalTitle {
            title_type: "Japanese".into(),
            title: t,
        });
    }
    if let Some(t) = non_empty(alt.en) {
        titles.push(MalTitle {
            title_type: "English".into(),
            title: t,
        });
    }
    let authors = manga
        .authors
        .iter()
        .map(|a| MalAuthor {
            mal_id: a.node.id,
            name: jikan_style_name(&a.node),
            url: a
                .node
                .id
                .map(|id| format!("https://myanimelist.net/people/{id}")),
        })
        .filter(|a| !a.name.is_empty())
        .collect();
    MalMangaData {
        mal_id: manga.id,
        images: images_from(manga.main_picture),
        titles: Some(titles),
        title,
        volumes: manga.num_volumes.filter(|n| *n > 0),
        genres: manga_genres(genres),
        explicit_genres: manga_genres(explicit),
        demographics: manga_genres(demographics),
        authors: Some(authors),
    }
}

/* ══════════════════════════════════════════════════════════════════
 *  Shapes the rest of the server reads (Jikan's)
 * ══════════════════════════════════════════════════════════════════ */

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

impl MalMangaData {
    /// The first author with a name — the one this app records.
    pub fn primary_author(&self) -> Option<&MalAuthor> {
        self.authors
            .as_ref()
            .and_then(|list| list.iter().find(|a| !a.name.trim().is_empty()))
    }
}

/* ══════════════════════════════════════════════════════════════════
 *  A manga's details
 * ══════════════════════════════════════════════════════════════════ */

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

    // Cache lookup: on a hit we return immediately without touching an
    // upstream. `Option<MalMangaData>` serialization handles both the
    // "found" case and the "known-absent" case (JSON `null`).
    if let Some(cache) = cache
        && let Some(cached) = cache.get::<Option<MalMangaData>>(&cache_key).await
    {
        return Ok(cached);
    }

    let Some(data) = manga_with(upstream(), client, mal_id).await? else {
        // 4xx/5xx are not cached — we want to retry next time,
        // especially for a transient rate limit (429).
        return Ok(None);
    };

    if let Some(cache) = cache {
        cache.set(&cache_key, &data, MAL_DETAILS_TTL).await;
    }

    Ok(data)
}

/// `Ok(None)` — no usable answer, do not cache. `Ok(Some(None))` — the
/// upstream answered, without data (cacheable). `Ok(Some(Some(_)))` — the
/// manga.
async fn manga_with(
    up: &Upstream,
    client: &reqwest::Client,
    mal_id: i32,
) -> anyhow::Result<Option<Option<MalMangaData>>> {
    if let Some(official) = &up.official {
        let id = mal_id.to_string();
        match official_json::<OfficialManga>(
            client,
            official,
            &["manga", &id],
            &[("fields", DETAIL_FIELDS)],
        )
        .await
        {
            Ok(Answer::Found(manga)) => return Ok(Some(Some(from_official(manga)))),
            Ok(Answer::Missing) => return Ok(None),
            Err(err) => {
                tracing::warn!(mal_id, error = %err, "MyAnimeList API failed; asking Jikan");
            }
        }
    }

    let url = up.jikan_url(&["manga", &mal_id.to_string(), "full"]);
    let response = client
        .get(url)
        .timeout(USER_FACING_FETCH_TIMEOUT)
        .send()
        .await
        .context("Failed to reach Jikan")?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let body: serde_json::Value = response
        .json()
        .await
        .context("Failed to parse Jikan response")?;
    // 互 · A mirror in another dialect is read as Jikan v4.
    let data = jikan_compat::manga(body["data"].clone());
    Ok(Some(serde_json::from_value(data).ok()))
}

/* ══════════════════════════════════════════════════════════════════
 *  Alternate covers
 * ══════════════════════════════════════════════════════════════════ */

/// Pictures for a MAL manga — usually 3–8 alternate covers / key-visuals per
/// popular series. 7-day TTL: these rarely change post-release.
const MAL_PICTURES_TTL: Duration = Duration::from_secs(7 * 24 * 3600);

/// Fetch the list of alternate cover images MAL ships for this manga.
/// Returns the large rendition preferentially, the regular one when the
/// large is missing. Best-effort: empty Vec on any failure so the caller
/// can fall through.
pub async fn get_pictures(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    mal_id: i32,
) -> anyhow::Result<Vec<String>> {
    let cache_key = format!("mal:pictures:{}", mal_id);
    if let Some(cache) = cache
        && let Some(cached) = cache.get::<Vec<String>>(&cache_key).await
    {
        return Ok(cached);
    }

    let Some(out) = pictures_with(upstream(), client, mal_id).await? else {
        return Ok(Vec::new());
    };

    if let Some(cache) = cache {
        cache.set(&cache_key, &out, MAL_PICTURES_TTL).await;
    }
    Ok(out)
}

async fn pictures_with(
    up: &Upstream,
    client: &reqwest::Client,
    mal_id: i32,
) -> anyhow::Result<Option<Vec<String>>> {
    if let Some(official) = &up.official {
        let id = mal_id.to_string();
        match official_json::<OfficialManga>(
            client,
            official,
            &["manga", &id],
            &[("fields", "pictures")],
        )
        .await
        {
            Ok(Answer::Found(manga)) => {
                return Ok(Some(
                    manga
                        .pictures
                        .into_iter()
                        .filter_map(|p| p.large.or(p.medium))
                        .collect(),
                ));
            }
            Ok(Answer::Missing) => return Ok(Some(Vec::new())),
            Err(err) => {
                tracing::warn!(mal_id, error = %err, "MyAnimeList API failed; asking Jikan");
            }
        }
    }

    let url = up.jikan_url(&["manga", &mal_id.to_string(), "pictures"]);
    let response = client
        .get(url)
        .timeout(USER_FACING_FETCH_TIMEOUT)
        .send()
        .await
        .context("Failed to reach Jikan pictures endpoint")?;
    if !response.status().is_success() {
        return Ok(None);
    }

    let body: serde_json::Value = response
        .json()
        .await
        .context("Failed to parse Jikan pictures response")?;

    Ok(Some(
        jikan_compat::data_list(&body, jikan_compat::picture)
            .into_iter()
            .filter_map(|v| serde_json::from_value::<MalImages>(v).ok())
            .filter_map(|imgs| imgs.jpg.and_then(|j| j.large_image_url.or(j.image_url)))
            .collect(),
    ))
}

/* ══════════════════════════════════════════════════════════════════
 *  Search
 * ══════════════════════════════════════════════════════════════════ */

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

/// The official API refuses a search shorter than this; such a query
/// goes to Jikan.
const OFFICIAL_SEARCH_MIN_CHARS: usize = 3;

/// Search MyAnimeList by free-text title. Returns up to 10 results,
/// cached 15 min. `Err` means the upstreams are in trouble (unreachable,
/// 5xx, rate-limited), which the merged search reports as degraded.
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
        && let Some(cached) = cache.get::<Vec<MalSearchResult>>(&cache_key).await
    {
        return Ok(cached);
    }

    let results = search_with(upstream(), client, trimmed).await?;

    if let Some(cache) = cache {
        cache.set(&cache_key, &results, MAL_SEARCH_TTL).await;
    }
    Ok(results)
}

async fn search_with(
    up: &Upstream,
    client: &reqwest::Client,
    query: &str,
) -> anyhow::Result<Vec<MalSearchResult>> {
    if let Some(official) = &up.official
        && query.chars().count() >= OFFICIAL_SEARCH_MIN_CHARS
    {
        match official_json::<OfficialPage<OfficialNode<OfficialManga>>>(
            client,
            official,
            &["manga"],
            &[
                ("q", query),
                ("limit", "10"),
                // Without it the official search leaves out every
                // adult title, which Jikan never did; the adult gate is
                // this app's, per reader.
                ("nsfw", "true"),
                ("fields", SEARCH_FIELDS),
            ],
        )
        .await
        {
            Ok(Answer::Found(page)) => {
                return Ok(page
                    .data
                    .into_iter()
                    .map(|n| search_result_from_official(n.node))
                    .collect());
            }
            Ok(Answer::Missing) => return Ok(Vec::new()),
            Err(err) => {
                tracing::warn!(error = %err, "MyAnimeList API search failed; asking Jikan");
            }
        }
    }

    let response = client
        .get(up.jikan_url(&["manga"]))
        // No `limit`: Jikan pages at 25 anyway, and a mirror that serves
        // one MyAnimeList page per request refuses the parameter (400).
        // The first ten are kept below.
        .query(&[("q", query)])
        .timeout(USER_FACING_FETCH_TIMEOUT)
        .send()
        .await
        .context("Failed to reach Jikan")?;

    let status = response.status();
    if status.is_server_error() || status.as_u16() == 429 {
        // Real upstream trouble (5xx, rate-limit) — surface as Err so the
        // caller (merged_search) can flag the outcome as `degraded` and
        // route the client into its transient/retry UI instead of the
        // misleading "no results" path. Other non-2xx (rare 4xx) stay an
        // empty list — semantically the query just didn't match.
        anyhow::bail!("Jikan search non-success status: {status}");
    }
    if !status.is_success() {
        return Ok(Vec::new());
    }

    let body: serde_json::Value = response
        .json()
        .await
        .context("Failed to parse Jikan search response")?;
    Ok(jikan_compat::data_list(&body, jikan_compat::manga)
        .into_iter()
        .filter_map(|v| serde_json::from_value::<MalSearchRaw>(v).ok())
        .take(10)
        .map(search_result_from_jikan)
        .collect())
}

fn search_result_from_jikan(r: MalSearchRaw) -> MalSearchResult {
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
}

fn search_result_from_official(manga: OfficialManga) -> MalSearchResult {
    let score = manga.mean;
    let data = from_official(manga);
    let genres = data
        .genres
        .iter()
        .flatten()
        .chain(data.explicit_genres.iter().flatten())
        .chain(data.demographics.iter().flatten())
        .map(|g| g.name.clone())
        .collect();
    MalSearchResult {
        mal_id: data.mal_id,
        name: data.title.clone().unwrap_or_default(),
        image_url: data
            .images
            .as_ref()
            .and_then(|i| i.jpg.as_ref())
            .and_then(|j| j.large_image_url.clone().or(j.image_url.clone())),
        volumes: data.volumes,
        genres,
        score,
    }
}

/* ══════════════════════════════════════════════════════════════════
 *  Recommendations and characters — what the browser used to ask
 *  Jikan for itself
 * ══════════════════════════════════════════════════════════════════ */

/// Readers' recommendations and characters change slowly.
const MAL_SOCIAL_TTL: Duration = Duration::from_secs(7 * 24 * 3600);

/// "Readers of this also liked…", with how many readers said so.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MalRecommendation {
    pub mal_id: i32,
    pub title: String,
    pub image_url: Option<String>,
    pub votes: i32,
}

/// A character of a manga, as the avatar picker shows it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MalCharacter {
    pub mal_id: i32,
    pub name: String,
    /// "Main" or "Supporting".
    pub role: Option<String>,
    pub image_url: Option<String>,
}

/// Recommendations for a manga. An unknown manga has none; `Err` means
/// no upstream answered.
pub async fn get_recommendations(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    mal_id: i32,
) -> anyhow::Result<Vec<MalRecommendation>> {
    let cache_key = format!("mal:recommendations:{}", mal_id);
    if let Some(cache) = cache
        && let Some(cached) = cache.get::<Vec<MalRecommendation>>(&cache_key).await
    {
        return Ok(cached);
    }
    let out = recommendations_with(upstream(), client, mal_id).await?;
    if let Some(cache) = cache {
        cache.set(&cache_key, &out, MAL_SOCIAL_TTL).await;
    }
    Ok(out)
}

async fn recommendations_with(
    up: &Upstream,
    client: &reqwest::Client,
    mal_id: i32,
) -> anyhow::Result<Vec<MalRecommendation>> {
    if let Some(official) = &up.official {
        let id = mal_id.to_string();
        match official_json::<OfficialManga>(
            client,
            official,
            &["manga", &id],
            &[("fields", "recommendations")],
        )
        .await
        {
            Ok(Answer::Found(manga)) => {
                return Ok(manga
                    .recommendations
                    .into_iter()
                    .filter_map(|r| {
                        let votes = r.num_recommendations.unwrap_or(1).max(1);
                        let picture = r.node.main_picture;
                        Some(MalRecommendation {
                            mal_id: r.node.id,
                            title: non_empty(r.node.title)?,
                            image_url: picture.and_then(|p| p.medium.or(p.large)),
                            votes,
                        })
                    })
                    .collect());
            }
            Ok(Answer::Missing) => return Ok(Vec::new()),
            Err(err) => {
                tracing::warn!(mal_id, error = %err, "MyAnimeList API failed; asking Jikan");
            }
        }
    }

    #[derive(Deserialize)]
    struct Item {
        entry: Entry,
        #[serde(default)]
        votes: Option<i32>,
    }
    #[derive(Deserialize)]
    struct Entry {
        mal_id: i32,
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        images: Option<MalImages>,
    }

    let Some(items) = jikan_items(
        up,
        client,
        &["manga", &mal_id.to_string(), "recommendations"],
        jikan_compat::recommendation,
    )
    .await?
    else {
        return Ok(Vec::new());
    };
    Ok(items
        .into_iter()
        .filter_map(|v| serde_json::from_value::<Item>(v).ok())
        .filter_map(|item| {
            Some(MalRecommendation {
                mal_id: item.entry.mal_id,
                title: non_empty(item.entry.title)?,
                image_url: item
                    .entry
                    .images
                    .and_then(|i| i.jpg)
                    .and_then(|j| j.image_url.or(j.small_image_url)),
                votes: item.votes.unwrap_or(1).max(1),
            })
        })
        .collect())
}

/// Characters of a manga. Jikan only: the official API has no such
/// endpoint.
pub async fn get_characters(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    mal_id: i32,
) -> anyhow::Result<Vec<MalCharacter>> {
    let cache_key = format!("mal:characters:{}", mal_id);
    if let Some(cache) = cache
        && let Some(cached) = cache.get::<Vec<MalCharacter>>(&cache_key).await
    {
        return Ok(cached);
    }
    let out = characters_with(upstream(), client, mal_id).await?;
    if let Some(cache) = cache {
        cache.set(&cache_key, &out, MAL_SOCIAL_TTL).await;
    }
    Ok(out)
}

async fn characters_with(
    up: &Upstream,
    client: &reqwest::Client,
    mal_id: i32,
) -> anyhow::Result<Vec<MalCharacter>> {
    #[derive(Deserialize)]
    struct Item {
        character: Character,
        #[serde(default)]
        role: Option<String>,
    }
    #[derive(Deserialize)]
    struct Character {
        mal_id: i32,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        images: Option<MalImages>,
    }

    let Some(items) = jikan_items(
        up,
        client,
        &["manga", &mal_id.to_string(), "characters"],
        jikan_compat::character,
    )
    .await?
    else {
        return Ok(Vec::new());
    };
    Ok(items
        .into_iter()
        .filter_map(|v| serde_json::from_value::<Item>(v).ok())
        .filter_map(|item| {
            let images = item.character.images;
            let image_url = images
                .as_ref()
                .and_then(|i| i.jpg.as_ref())
                .and_then(|j| j.image_url.clone())
                .or_else(|| {
                    images
                        .as_ref()
                        .and_then(|i| i.webp.as_ref())
                        .and_then(|w| w.image_url.clone())
                });
            Some(MalCharacter {
                mal_id: item.character.mal_id,
                name: non_empty(item.character.name)?,
                role: item.role,
                image_url,
            })
        })
        .collect())
}

/// One GET against Jikan for the endpoints the browser used to call:
/// the `data` items, each passed through `normalise` so a mirror in
/// another dialect reads as Jikan v4. `Ok(None)` is a 404; any other
/// failure is an `Err`.
async fn jikan_items(
    up: &Upstream,
    client: &reqwest::Client,
    segments: &[&str],
    normalise: fn(serde_json::Value) -> serde_json::Value,
) -> anyhow::Result<Option<Vec<serde_json::Value>>> {
    let response = client
        .get(up.jikan_url(segments))
        .timeout(USER_FACING_FETCH_TIMEOUT)
        .send()
        .await
        .context("Failed to reach Jikan")?;
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !status.is_success() {
        anyhow::bail!("Jikan answered {status}");
    }
    let body = response
        .json::<serde_json::Value>()
        .await
        .context("Failed to parse Jikan response")?;
    Ok(Some(jikan_compat::data_list(&body, normalise)))
}

/* ══════════════════════════════════════════════════════════════════
 *  A public list, for the import by username
 * ══════════════════════════════════════════════════════════════════ */

/// One entry of a public list, as the official API ships it.
#[derive(Debug, Deserialize)]
pub(crate) struct OfficialListEntry {
    pub(crate) node: OfficialListManga,
    #[serde(default)]
    pub(crate) list_status: Option<OfficialListStatus>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OfficialListManga {
    pub(crate) id: i32,
    pub(crate) title: String,
    #[serde(default)]
    main_picture: Option<OfficialPicture>,
    /// 0 when MAL does not know the total yet.
    #[serde(default)]
    pub(crate) num_volumes: Option<i32>,
    #[serde(default)]
    pub(crate) genres: Vec<OfficialGenre>,
}

impl OfficialListManga {
    pub(crate) fn image_url(&self) -> Option<String> {
        self.main_picture
            .as_ref()
            .and_then(|p| p.large.clone().or_else(|| p.medium.clone()))
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct OfficialListStatus {
    /// `reading`, `completed`, `on_hold`, `dropped`, `plan_to_read`.
    #[serde(default)]
    pub(crate) status: Option<String>,
    #[serde(default)]
    pub(crate) num_volumes_read: Option<i32>,
    #[serde(default)]
    pub(crate) start_date: Option<String>,
    #[serde(default)]
    pub(crate) finish_date: Option<String>,
}

/// Why a public list could not be read from the official API.
pub(crate) enum ListFailure {
    /// No such user.
    NotFound,
    /// MAL refused: a private list, or a client id it does not accept.
    Refused,
    /// No answer worth trusting — the caller may ask Jikan instead.
    Unavailable(anyhow::Error),
}

/// A user's public manga list from the official API, at most `limit`
/// entries. `None` when the official API is not configured.
pub(crate) async fn official_user_mangalist(
    client: &reqwest::Client,
    username: &str,
    limit: usize,
    timeout: Duration,
) -> Option<Result<Vec<OfficialListEntry>, ListFailure>> {
    official_user_mangalist_with(upstream(), client, username, limit, timeout).await
}

async fn official_user_mangalist_with(
    up: &Upstream,
    client: &reqwest::Client,
    username: &str,
    limit: usize,
    timeout: Duration,
) -> Option<Result<Vec<OfficialListEntry>, ListFailure>> {
    let official = up.official.as_ref()?;
    // The official API pages at 1 000 at most; one page covers the
    // importer's own ceiling.
    let limit = limit.clamp(1, 1000).to_string();
    let request = client
        .get(join(&official.base, &["users", username, "mangalist"]))
        .query(&[
            ("fields", "list_status,num_volumes,genres,main_picture"),
            ("limit", limit.as_str()),
            ("nsfw", "true"),
        ])
        .header(MAL_CLIENT_ID_HEADER, official.client_id.clone())
        .timeout(timeout);
    let response = match request.send().await {
        Ok(r) => r,
        Err(e) => return Some(Err(ListFailure::Unavailable(e.into()))),
    };
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Some(Err(ListFailure::NotFound));
    }
    if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::UNAUTHORIZED {
        return Some(Err(ListFailure::Refused));
    }
    if !status.is_success() {
        return Some(Err(ListFailure::Unavailable(
            official_failure(response).await,
        )));
    }
    Some(
        response
            .json::<OfficialPage<OfficialListEntry>>()
            .await
            .map(|page| page.data)
            .map_err(|e| ListFailure::Unavailable(e.into())),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, extract::Query, http::HeaderMap, routing::get};
    use std::collections::HashMap;

    /* ── configuration ─────────────────────────────────────────── */

    #[test]
    fn the_public_jikan_is_the_default() {
        let up = Upstream::from_settings(None, None);
        assert_eq!(up.jikan_base(), DEFAULT_JIKAN_BASE);
        assert!(!up.uses_official_api());
        let up = Upstream::from_settings(Some("   "), Some("  "));
        assert_eq!(up.jikan_base(), DEFAULT_JIKAN_BASE);
        assert!(
            !up.uses_official_api(),
            "an empty client id is no client id"
        );
    }

    #[test]
    fn a_mirror_takes_the_place_of_jikan() {
        let up = Upstream::from_settings(Some("https://jikan.example.org/v4/"), None);
        assert_eq!(
            up.jikan_url(&["manga", "13", "full"]).as_str(),
            "https://jikan.example.org/v4/manga/13/full",
            "a trailing slash on the base must not double the separator"
        );
        let up = Upstream::from_settings(Some("http://jikan:8080"), None);
        assert_eq!(up.jikan_url(&["manga"]).as_str(), "http://jikan:8080/manga");
    }

    #[test]
    fn an_unusable_base_falls_back_to_the_public_jikan() {
        for raw in [
            "jikan.example.org/v4",       // no scheme
            "ftp://jikan.example.org/v4", // not http(s)
            "https://jikan.example.org/v4?key=1",
            "https://jikan.example.org/v4#x",
            "https://user:pass@jikan.example.org/v4",
        ] {
            let up = Upstream::from_settings(Some(raw), None);
            assert_eq!(
                up.jikan_base(),
                DEFAULT_JIKAN_BASE,
                "{raw} should be refused"
            );
        }
    }

    #[test]
    fn a_segment_cannot_leave_the_base() {
        let up = Upstream::from_settings(Some("https://jikan.example.org/v4"), None);
        let url = up.jikan_url(&["users", "../../evil", "mangalist"]);
        assert_eq!(url.host_str(), Some("jikan.example.org"));
        assert!(url.path().starts_with("/v4/users/"));
    }

    #[test]
    fn a_client_id_turns_the_official_api_on_and_is_never_printed() {
        let up = Upstream::from_settings(None, Some(" 0123456789abcdef "));
        assert!(up.uses_official_api());
        assert!(!format!("{up:?}").contains("0123456789abcdef"));
        // A value no header can carry is refused rather than sent.
        let up = Upstream::from_settings(None, Some("abc\ndef"));
        assert!(!up.uses_official_api());
    }

    /* ── reshaping the official answers ────────────────────────── */

    const OFFICIAL_ONE_PIECE: &str = r#"{
        "id": 13,
        "title": "One Piece",
        "main_picture": {
            "medium": "https://cdn.myanimelist.net/images/manga/2/253146.jpg",
            "large": "https://cdn.myanimelist.net/images/manga/2/253146l.jpg"
        },
        "alternative_titles": {"synonyms": ["OP"], "en": "One Piece", "ja": "ONE PIECE"},
        "num_volumes": 0,
        "mean": 9.22,
        "genres": [
            {"id": 1, "name": "Action"},
            {"id": 2, "name": "Adventure"},
            {"id": 10, "name": "Fantasy"},
            {"id": 27, "name": "Shounen"},
            {"id": 38, "name": "Military"}
        ],
        "authors": [
            {"node": {"id": 1881, "first_name": "Eiichiro", "last_name": "Oda"}, "role": "Story & Art"}
        ]
    }"#;

    #[test]
    fn an_official_manga_reads_like_a_jikan_one() {
        let manga: OfficialManga = serde_json::from_str(OFFICIAL_ONE_PIECE).unwrap();
        let data = from_official(manga);
        assert_eq!(data.mal_id, 13);
        assert_eq!(data.title.as_deref(), Some("One Piece"));
        // MAL's 0 is "not known yet", which Jikan says as null.
        assert_eq!(data.volumes, None);
        let jpg = data.images.as_ref().and_then(|i| i.jpg.as_ref()).unwrap();
        assert_eq!(
            jpg.image_url.as_deref(),
            Some("https://cdn.myanimelist.net/images/manga/2/253146.jpg")
        );
        assert_eq!(
            jpg.large_image_url.as_deref(),
            Some("https://cdn.myanimelist.net/images/manga/2/253146l.jpg")
        );
        let names = |g: &Option<Vec<MalGenre>>| -> Vec<String> {
            g.iter().flatten().map(|g| g.name.clone()).collect()
        };
        assert_eq!(names(&data.genres), ["Action", "Adventure", "Fantasy"]);
        assert_eq!(names(&data.demographics), ["Shounen"]);
        assert!(
            data.genres
                .iter()
                .flatten()
                .all(|g| g.genre_type == "manga"),
            "the library keeps only genres typed `manga`"
        );
        // Military is a theme: Jikan keeps those apart and so do we.
        assert!(!names(&data.genres).contains(&"Military".to_string()));
        let author = data.primary_author().unwrap();
        assert_eq!(author.mal_id, Some(1881));
        assert_eq!(author.name, "Oda, Eiichiro", "Jikan's \"Family, Given\"");
        let titles: Vec<(String, String)> = data
            .titles
            .iter()
            .flatten()
            .map(|t| (t.title_type.clone(), t.title.clone()))
            .collect();
        assert!(titles.contains(&("Default".into(), "One Piece".into())));
        assert!(titles.contains(&("English".into(), "One Piece".into())));
        assert!(titles.contains(&("Japanese".into(), "ONE PIECE".into())));
        assert!(titles.contains(&("Synonym".into(), "OP".into())));
    }

    #[test]
    fn explicit_genres_survive_the_split() {
        let list: Vec<OfficialGenre> = ["Romance", "Hentai", "School", "Seinen"]
            .into_iter()
            .map(|name| OfficialGenre { name: name.into() })
            .collect();
        let (genres, explicit, demographics) = split_genres(&list);
        assert_eq!(genres, ["Romance"]);
        assert_eq!(explicit, ["Hentai"], "the adult gate reads these");
        assert_eq!(demographics, ["Seinen"]);
    }

    #[test]
    fn a_one_part_name_is_kept_whole() {
        let person = OfficialPerson {
            id: Some(1),
            first_name: Some(String::new()),
            last_name: Some("CLAMP".into()),
        };
        assert_eq!(jikan_style_name(&person), "CLAMP");
    }

    /* ── against a mock of both upstreams ──────────────────────── */

    /// A local stand-in for both upstreams. `/mal/...` plays the
    /// official API — it answers only with the right client id (an
    /// unknown one gets the real API's 400 "Invalid client id"), and
    /// fails with 500 for manga 500 — and `/jikan/...` plays Jikan.
    async fn mock() -> String {
        async fn official_manga(
            axum::extract::Path(id): axum::extract::Path<i32>,
            headers: HeaderMap,
            Query(q): Query<HashMap<String, String>>,
        ) -> (axum::http::StatusCode, String) {
            if headers.get("x-mal-client-id").and_then(|v| v.to_str().ok()) != Some("good-id") {
                // What the real API answers to an unknown id.
                return (
                    axum::http::StatusCode::BAD_REQUEST,
                    r#"{"message":"Invalid client id","error":"bad_request"}"#.into(),
                );
            }
            match id {
                13 => {
                    let fields = q.get("fields").cloned().unwrap_or_default();
                    if fields == "recommendations" {
                        (
                            axum::http::StatusCode::OK,
                            r#"{"id":13,"recommendations":[
                                {"node":{"id":21,"title":"Fairy Tail","main_picture":{"medium":"https://cdn.myanimelist.net/images/manga/3/1.jpg"}},"num_recommendations":7}
                            ]}"#
                            .into(),
                        )
                    } else {
                        (axum::http::StatusCode::OK, OFFICIAL_ONE_PIECE.into())
                    }
                }
                500 => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "{}".into()),
                _ => (axum::http::StatusCode::NOT_FOUND, "{}".into()),
            }
        }
        async fn jikan_manga(
            axum::extract::Path(id): axum::extract::Path<i32>,
        ) -> (axum::http::StatusCode, String) {
            (
                axum::http::StatusCode::OK,
                format!(
                    r#"{{"data":{{"mal_id":{id},"title":"From Jikan","images":{{"jpg":{{"image_url":"https://cdn.myanimelist.net/images/manga/1/{id}.jpg"}}}},"volumes":3}}}}"#
                ),
            )
        }
        async fn jikan_characters() -> String {
            r#"{"data":[
                {"character":{"mal_id":40,"name":"Monkey D., Luffy","images":{"jpg":{"image_url":"https://cdn.myanimelist.net/images/characters/9/310307.jpg"}}},"role":"Main"},
                {"character":{"mal_id":41,"name":"","images":{}},"role":"Supporting"}
            ]}"#
            .into()
        }
        async fn official_list(
            axum::extract::Path(user): axum::extract::Path<String>,
        ) -> (axum::http::StatusCode, String) {
            match user.as_str() {
                "reader" => (
                    axum::http::StatusCode::OK,
                    r#"{"data":[
                        {"node":{"id":13,"title":"One Piece","num_volumes":0,"genres":[{"id":1,"name":"Action"}]},
                         "list_status":{"status":"on_hold","num_volumes_read":12,"start_date":"2020-01-02"}}
                    ],"paging":{}}"#
                        .into(),
                ),
                "secret" => (axum::http::StatusCode::FORBIDDEN, "{}".into()),
                _ => (axum::http::StatusCode::NOT_FOUND, "{}".into()),
            }
        }
        let app = Router::new()
            .route("/mal/manga/{id}", get(official_manga))
            .route("/mal/users/{user}/mangalist", get(official_list))
            .route("/jikan/manga/{id}/full", get(jikan_manga))
            .route("/jikan/manga/{id}/characters", get(jikan_characters));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    fn up(base: &str, client_id: Option<&str>) -> Upstream {
        let mal = format!("{base}/mal");
        Upstream::for_tests(
            &format!("{base}/jikan"),
            client_id.map(|id| (mal.as_str(), id)),
        )
    }

    #[tokio::test]
    async fn the_official_api_answers_first_with_the_client_id() {
        let base = mock().await;
        let client = reqwest::Client::new();
        let data = manga_with(&up(&base, Some("good-id")), &client, 13)
            .await
            .unwrap()
            .flatten()
            .unwrap();
        assert_eq!(data.title.as_deref(), Some("One Piece"), "not Jikan's");
        assert_eq!(data.primary_author().unwrap().mal_id, Some(1881));
    }

    #[tokio::test]
    async fn without_a_client_id_jikan_answers() {
        let base = mock().await;
        let client = reqwest::Client::new();
        let data = manga_with(&up(&base, None), &client, 13)
            .await
            .unwrap()
            .flatten()
            .unwrap();
        assert_eq!(data.title.as_deref(), Some("From Jikan"));
    }

    #[tokio::test]
    async fn a_failing_official_api_falls_back_to_jikan() {
        let base = mock().await;
        let client = reqwest::Client::new();
        // 500 from the official API → Jikan.
        let data = manga_with(&up(&base, Some("good-id")), &client, 500)
            .await
            .unwrap()
            .flatten()
            .unwrap();
        assert_eq!(data.title.as_deref(), Some("From Jikan"));
        // A refused client id is a failure too, not an answer.
        let data = manga_with(&up(&base, Some("bad-id")), &client, 13)
            .await
            .unwrap()
            .flatten()
            .unwrap();
        assert_eq!(data.title.as_deref(), Some("From Jikan"));
    }

    #[tokio::test]
    async fn a_refused_client_id_says_so() {
        let base = mock().await;
        let client = reqwest::Client::new();
        let up = up(&base, Some("bad-id"));
        let official = up.official.as_ref().unwrap();
        let Err(err) =
            official_json::<OfficialManga>(&client, official, &["manga", "13"], &[]).await
        else {
            panic!("a refused id is a failure");
        };
        assert_eq!(
            err.to_string(),
            "MyAnimeList API answered 400 Bad Request: Invalid client id",
            "the operator reads MAL's reason, not a bare status"
        );
    }

    #[tokio::test]
    async fn a_404_from_the_official_api_is_an_answer() {
        let base = mock().await;
        let client = reqwest::Client::new();
        let data = manga_with(&up(&base, Some("good-id")), &client, 404)
            .await
            .unwrap();
        assert!(data.is_none(), "not retried on Jikan, not cached");
    }

    #[tokio::test]
    async fn recommendations_and_characters_take_their_upstreams() {
        let base = mock().await;
        let client = reqwest::Client::new();
        let recs = recommendations_with(&up(&base, Some("good-id")), &client, 13)
            .await
            .unwrap();
        assert_eq!(
            recs,
            [MalRecommendation {
                mal_id: 21,
                title: "Fairy Tail".into(),
                image_url: Some("https://cdn.myanimelist.net/images/manga/3/1.jpg".into()),
                votes: 7,
            }]
        );
        // Characters exist only on Jikan, client id or not; a nameless
        // one is dropped.
        let chars = characters_with(&up(&base, Some("good-id")), &client, 13)
            .await
            .unwrap();
        assert_eq!(chars.len(), 1);
        assert_eq!(chars[0].name, "Monkey D., Luffy");
        assert_eq!(chars[0].role.as_deref(), Some("Main"));
    }

    #[tokio::test]
    async fn an_unreachable_jikan_is_an_error_not_an_empty_answer() {
        let client = reqwest::Client::new();
        // Nothing listens on port 9 of the loopback.
        let up = Upstream::for_tests("http://127.0.0.1:9/v4", None);
        assert!(characters_with(&up, &client, 13).await.is_err());
        assert!(recommendations_with(&up, &client, 13).await.is_err());
    }

    #[tokio::test]
    async fn a_public_list_reads_from_the_official_api() {
        let base = mock().await;
        let client = reqwest::Client::new();
        let timeout = Duration::from_secs(5);
        let up_ok = up(&base, Some("good-id"));
        let entries = official_user_mangalist_with(&up_ok, &client, "reader", 500, timeout)
            .await
            .unwrap()
            .ok()
            .unwrap();
        assert_eq!(entries.len(), 1);
        let status = entries[0].list_status.as_ref().unwrap();
        assert_eq!(status.status.as_deref(), Some("on_hold"));
        assert_eq!(status.num_volumes_read, Some(12));
        assert!(matches!(
            official_user_mangalist_with(&up_ok, &client, "secret", 500, timeout).await,
            Some(Err(ListFailure::Refused))
        ));
        assert!(matches!(
            official_user_mangalist_with(&up_ok, &client, "nobody", 500, timeout).await,
            Some(Err(ListFailure::NotFound))
        ));
        // Not configured: the caller goes to Jikan.
        assert!(
            official_user_mangalist_with(&up(&base, None), &client, "reader", 500, timeout)
                .await
                .is_none()
        );
    }
}
