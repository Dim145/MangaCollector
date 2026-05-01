//! 書 · Google Books API client (backend) — primary discovery source
//! for upcoming manga-volume releases.
//!
//! Why this is the *primary* source (vs MangaUpdates):
//!
//!   MangaUpdates' release feed is a scanlation tracker — `volume`
//!   is null on ~99% of releases, the rest are scanlation chapters
//!   tagged with a volume index, NOT physical / digital commercial
//!   releases. Google Books, by contrast, indexes publishers'
//!   catalogues (VIZ, Glénat, Kurokawa, Pika, Kadokawa, Yen Press,
//!   etc.) with `publishedDate` fields that are populated for
//!   pre-orders weeks-to-months in advance of shelf date.
//!
//! Strategy:
//!
//!   We don't go through MangaUpdates first. Given a series title +
//!   the highest volume number we already know about (from the
//!   user's `user_volumes` rows), we probe Google Books for the
//!   next 1..=N candidate volume numbers, accept anything that
//!   comes back with a futur `publishedDate`, and stop when we hit
//!   two consecutive misses. That heuristic keeps API quota under
//!   control while still finding all announced tomes for any
//!   active series.
//!
//! Auth:
//!
//!   API key is optional. Anonymous gets ~1000 req/day per IP;
//!   authenticated bumps that to ~100k/day. We thread the optional
//!   key through `find_volume` so an operator can configure
//!   `GOOGLE_BOOKS_API_KEY` if the nightly sweep starts hitting
//!   the anonymous cap.
//!
//! Caching:
//!
//!   - Hits cached 7d (publication dates rarely move once announced).
//!   - Misses cached 24h (a series with no announcement today might
//!     get one tomorrow).
//!   - Future-only filter is applied AFTER the cache lookup so a row
//!     whose date passed since we cached it falls out naturally.

use std::time::Duration;

use anyhow::Context;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use crate::services::cache::CacheStore;

const HIT_TTL: Duration = Duration::from_secs(7 * 24 * 3600);
const MISS_TTL: Duration = Duration::from_secs(24 * 3600);
const SEARCH_URL: &str = "https://www.googleapis.com/books/v1/volumes";
const USER_AGENT: &str = concat!("MangaCollector/", env!("CARGO_PKG_VERSION"));

/// One candidate volume the API returned. `release_date` is parsed
/// to UTC midnight on the publishedDate's day; ISBN-13 is preferred
/// over ISBN-10 when both are present.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GoogleBooksHit {
    pub release_date: DateTime<Utc>,
    pub isbn: Option<String>,
    pub publisher: Option<String>,
    pub cover_url: Option<String>,
    /// Echoed back so the caller can audit which Google-Books row
    /// won the match — useful when the heuristic mis-selects a
    /// translated edition vs the original-language one.
    pub matched_title: String,
}

/// Locate a specific (`series_title`, `vol_num`, `language`) tuple
/// on Google Books. Returns the first hit whose title contains both
/// the series name and a recognisable volume marker for the asked
/// number, AND whose `publishedDate` is in the future relative to
/// `now`. The future filter is part of the function's contract — a
/// retro hit (already-released tome) is NOT what the caller wants
/// here; the cascade only cares about announcements.
///
/// `language_iso` is the 3-letter Google Books code: `eng`, `fre`,
/// `spa`, `jpn`, ... Passing `eng` covers the broadest catalogue
/// (default in the cron), per-user calls thread the user's locale
/// preference.
pub async fn find_volume(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    api_key: Option<&str>,
    series_title: &str,
    vol_num: i32,
    language_iso: &str,
) -> anyhow::Result<Option<GoogleBooksHit>> {
    let series = series_title.trim();
    if series.is_empty() || vol_num < 0 {
        return Ok(None);
    }
    // Cache key intentionally omits the API key — the response is
    // identical with or without it (the key only affects the per-IP
    // quota), so cache hits work across both anonymous and keyed
    // calls.
    let cache_key = format!(
        "gbooks:vol:{}:{}:{}",
        series.to_lowercase(),
        vol_num,
        language_iso
    );

    if let Some(cache) = cache
        && let Some(cached) =
            cache.get::<Option<GoogleBooksHit>>(&cache_key).await
        {
            // Re-apply the future filter on cache hit — the cache
            // entry's date may have slipped into the past since we
            // wrote it.
            return Ok(cached.filter(|h| h.release_date > Utc::now()));
        }

    // Query string. `intitle:` makes Google Books prioritise titles
    // containing the series name, the loose `Vol N` term tightens
    // the rank toward the right tome without forcing an exact
    // match (publishers' subtitle conventions vary too much for an
    // exact `intitle:"Vol N"` to work everywhere). 20 results lets
    // us scan past edition/special-printing collisions before
    // giving up.
    let q = format!("intitle:\"{}\" Vol {}", series, vol_num);
    let mut req = client
        .get(SEARCH_URL)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .query(&[
            ("q", q.as_str()),
            ("printType", "books"),
            ("maxResults", "20"),
            ("langRestrict", language_iso),
        ]);
    if let Some(key) = api_key.filter(|s| !s.is_empty()) {
        req = req.query(&[("key", key)]);
    }

    let response = req
        .send()
        .await
        .context("Failed to reach Google Books")?;

    if !response.status().is_success() {
        // Don't cache a transient 4xx/5xx — Google Books occasionally
        // 429s the anonymous tier; we'd rather retry next sweep than
        // freeze a wrong negative for a day.
        return Ok(None);
    }

    let body: GbVolumeList = response
        .json()
        .await
        .context("Failed to parse Google Books response")?;

    let now = Utc::now();
    let mut best: Option<GoogleBooksHit> = None;
    for item in body.items.unwrap_or_default() {
        let info = match item.volume_info {
            Some(v) => v,
            None => continue,
        };
        let title = info.title.clone().unwrap_or_default();
        if !title_matches(&title, info.subtitle.as_deref(), series, vol_num) {
            continue;
        }
        let Some(date_str) = info.published_date.as_deref() else {
            continue;
        };
        let Some(release_date) = parse_published_date(date_str) else {
            continue;
        };
        if release_date <= now {
            continue;
        }

        let isbn = info
            .industry_identifiers
            .as_ref()
            .map(|ids| pick_best_isbn(ids))
            .unwrap_or_default();
        let publisher = info.publisher.clone().filter(|s| !s.trim().is_empty());
        let cover_url = info
            .image_links
            .as_ref()
            .and_then(|i| {
                i.thumbnail
                    .clone()
                    .or_else(|| i.small_thumbnail.clone())
            })
            // Google Books returns thumbnails over HTTP by default;
            // upgrade to HTTPS so they render on our HTTPS-only
            // frontend without a mixed-content warning.
            .map(|u| u.replacen("http://", "https://", 1));

        // Best-match selection: prefer the row whose `release_date`
        // is *closest* to now in the future — that's likely the next
        // edition the user is waiting for. If there are duplicates
        // (rare) we keep the first.
        let candidate = GoogleBooksHit {
            release_date,
            isbn,
            publisher,
            cover_url,
            matched_title: title,
        };
        match &best {
            None => best = Some(candidate),
            Some(prev) if candidate.release_date < prev.release_date => {
                best = Some(candidate);
            }
            _ => {}
        }
    }

    if let Some(cache) = cache {
        let ttl = if best.is_some() { HIT_TTL } else { MISS_TTL };
        cache.set::<Option<GoogleBooksHit>>(&cache_key, &best, ttl).await;
    }
    Ok(best)
}

// ── Helpers ────────────────────────────────────────────────────────────

/// Heuristic title-match guard. Google Books search is loose enough
/// that a `q=intitle:"Frieren" Vol 15` query can return e.g.
/// "Frieren Beyond Journey's End" Vol 1, 5, 10, 12, 15, 20…
/// We accept a row only when:
///
///   1. The series_title (case-insensitive) is a substring of the
///      title or subtitle. This filters out unrelated series whose
///      title shares one word with the query.
///   2. The combined `title + subtitle` carries a numeric token that
///      matches `vol_num` next to a "vol", "tome", "巻", "tomo",
///      "band" marker, or as an `, NN` / ` NN` suffix. The marker
///      vocabulary covers the publishers we encountered in spot
///      checks; the bare "title NN" variant catches French and
///      Spanish editions that often skip the explicit "Tome".
fn title_matches(title: &str, subtitle: Option<&str>, series: &str, vol_num: i32) -> bool {
    let combined = format!(
        "{} {}",
        title,
        subtitle.unwrap_or("")
    )
    .to_lowercase();
    let series_lc = series.to_lowercase();
    if !combined.contains(&series_lc) {
        return false;
    }
    let n = vol_num.to_string();
    let patterns = [
        format!("vol. {}", n),
        format!("vol {}", n),
        format!("volume {}", n),
        format!("tome {}", n),
        format!("tomo {}", n),
        format!("band {}", n),
        // 巻 (kan/maki) marker
        format!("{}巻", n),
        format!("第{}巻", n),
        // Bare ", N" / " N" suffix when the title ends with the
        // number — covers French shelf-format editions.
        format!(", {}", n),
        format!(" #{}", n),
    ];
    for pat in &patterns {
        if combined.contains(pat) {
            // Guard: avoid matching "Vol 1" inside "Vol 10" by
            // checking the next char after the number isn't another
            // digit. Only matters when `n` is short ("1", "2").
            if let Some(idx) = combined.find(pat) {
                let after = &combined[idx + pat.len()..];
                if !after.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
                    return true;
                }
            }
        }
    }
    false
}

/// Parse Google Books' `publishedDate` field. Accepted shapes:
///
///   - `YYYY-MM-DD` (full date) — primary case for pre-orders
///   - `YYYY-MM`   — month precision; we treat as 1st of the month
///   - `YYYY`      — year only; reject (too imprecise to schedule)
///
/// Year-month resolution is acceptable here because the cascade's
/// "future-only" filter still rejects the row if `1st-of-month` is
/// in the past — worst case the user sees a release dated to the
/// 1st when it actually shipped on the 12th. The audit's strict
/// `YYYY-MM-DD`-only stance was for MangaUpdates where dates are
/// scanlation-precise; Google Books pre-order rows have looser
/// shapes and dropping all of them would cost too much coverage.
fn parse_published_date(s: &str) -> Option<DateTime<Utc>> {
    let trimmed = s.trim();
    // Full date.
    if let Ok(nd) = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        return nd.and_hms_opt(0, 0, 0).map(|n| n.and_utc());
    }
    // Year-month.
    if let Ok(nd) = NaiveDate::parse_from_str(&format!("{}-01", trimmed), "%Y-%m-%d") {
        return nd.and_hms_opt(0, 0, 0).map(|n| n.and_utc());
    }
    None
}

/// Prefer ISBN-13 over ISBN-10 — same policy as the OpenLibrary
/// fallback. Google Books returns both formats inside the
/// `industryIdentifiers` array.
fn pick_best_isbn(ids: &[GbIndustryIdentifier]) -> Option<String> {
    let mut isbn10: Option<String> = None;
    for id in ids {
        let kind = id.identifier_type.as_deref().unwrap_or("");
        let value = id.identifier.clone();
        match (kind, value) {
            ("ISBN_13", Some(v)) => return Some(v),
            ("ISBN_10", Some(v)) if isbn10.is_none() => isbn10 = Some(v),
            _ => {}
        }
    }
    isbn10
}

// ── Wire types ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct GbVolumeList {
    #[serde(default)]
    items: Option<Vec<GbVolume>>,
}

#[derive(Deserialize)]
struct GbVolume {
    #[serde(default, rename = "volumeInfo")]
    volume_info: Option<GbVolumeInfo>,
}

#[derive(Deserialize)]
struct GbVolumeInfo {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    subtitle: Option<String>,
    #[serde(default, rename = "publishedDate")]
    published_date: Option<String>,
    #[serde(default)]
    publisher: Option<String>,
    #[serde(default, rename = "industryIdentifiers")]
    industry_identifiers: Option<Vec<GbIndustryIdentifier>>,
    #[serde(default, rename = "imageLinks")]
    image_links: Option<GbImageLinks>,
}

#[derive(Deserialize)]
struct GbIndustryIdentifier {
    #[serde(default, rename = "type")]
    identifier_type: Option<String>,
    #[serde(default)]
    identifier: Option<String>,
}

#[derive(Deserialize)]
struct GbImageLinks {
    #[serde(default)]
    thumbnail: Option<String>,
    #[serde(default, rename = "smallThumbnail")]
    small_thumbnail: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_match_basic_en() {
        assert!(title_matches(
            "Frieren: Beyond Journey's End, Vol. 15",
            None,
            "Frieren",
            15
        ));
        assert!(title_matches(
            "Chainsaw Man, Vol. 18",
            None,
            "Chainsaw Man",
            18
        ));
    }

    #[test]
    fn title_match_french_editions() {
        assert!(title_matches(
            "Spy x Family - Tome 15",
            None,
            "Spy x Family",
            15
        ));
        assert!(title_matches(
            "One Piece - Édition originale - Tome 109",
            None,
            "One Piece",
            109
        ));
    }

    #[test]
    fn title_match_rejects_wrong_volume() {
        assert!(!title_matches(
            "Frieren: Beyond Journey's End, Vol. 15",
            None,
            "Frieren",
            14
        ));
        assert!(!title_matches(
            "Vol 1 of Frieren",
            None,
            "Frieren",
            10
        ));
    }

    #[test]
    fn title_match_avoids_substring_collision() {
        // Title says "Vol 10" — must not match query for "Vol 1".
        assert!(!title_matches(
            "Frieren: Beyond Journey's End, Vol. 10",
            None,
            "Frieren",
            1
        ));
    }

    #[test]
    fn parse_full_and_month_dates() {
        assert!(parse_published_date("2026-12-08").is_some());
        // Month-only treated as 1st.
        let m = parse_published_date("2026-12").unwrap();
        assert_eq!(m.format("%Y-%m-%d").to_string(), "2026-12-01");
        // Year-only rejected.
        assert!(parse_published_date("2026").is_none());
        assert!(parse_published_date("garbage").is_none());
    }

    #[test]
    fn isbn13_preferred() {
        let ids = vec![
            GbIndustryIdentifier {
                identifier_type: Some("ISBN_10".into()),
                identifier: Some("1974754936".into()),
            },
            GbIndustryIdentifier {
                identifier_type: Some("ISBN_13".into()),
                identifier: Some("9781974754939".into()),
            },
        ];
        assert_eq!(pick_best_isbn(&ids), Some("9781974754939".into()));
    }
}
