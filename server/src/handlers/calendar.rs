//! 暦 · Upcoming-volume calendar endpoints.
//!
//! Distinct from `handlers::library` because the calendar's domain
//! is *the user's whole release timeline* rather than any one
//! series. Keeping it in its own module makes the route surface
//! area easy to grep and lets future extensions (ICS export,
//! per-day endpoint, push-notification hooks) land beside the
//! HTML/JSON one without ballooning library.rs.

use axum::{
    extract::{Path, Query, State},
    http::header,
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Utc};
use serde::Deserialize;
use serde_json::json;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::services::{calendar_ics, releases, users};
use crate::state::AppState;

/// Query string for `/api/user/calendar/upcoming`.
///
/// Both bounds are optional — sensible defaults lock the window to
/// the next 12 months from today, which matches the caching horizon
/// of `discover_upcoming` and keeps payloads bounded.
///
/// Format: `YYYY-MM` (year-month). Anything finer-grained doesn't
/// match the calendar's mental model — users browse by month, not
/// by day. The handler interprets `from` as "first of month, UTC"
/// and `until` as "last day of month, 23:59:59 UTC" so the row
/// whose date is `until-end-of-month` is included.
#[derive(Debug, Deserialize)]
pub struct CalendarRangeQuery {
    pub from: Option<String>,
    pub until: Option<String>,
}

/// Default window length when the client omits both bounds.
const DEFAULT_WINDOW_MONTHS: i64 = 12;

/// GET /api/user/calendar/upcoming
///
/// Returns every announced volume in `[from, until]` for the calling
/// user, joined with series metadata (name + cover) and sorted
/// ascending by release date. Pagination is intentionally absent:
/// even an enthusiast tracking 200 series tops out around 50–100
/// upcoming rows in any reasonable window — well under the wire-
/// payload threshold where an offset/limit pair would pay off.
///
/// 404 / 500 modes are normal (no special "feed" envelope) — the
/// response is `{ from, until, releases: [...] }` so the client can
/// echo back the resolved bounds in case it sent partial input.
pub async fn list_upcoming(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(params): Query<CalendarRangeQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let now = Utc::now();
    let from = parse_month_start(params.from.as_deref())
        .unwrap_or_else(|| start_of_month_utc(now));
    let until_default = end_of_month_utc(now + Duration::days(30 * DEFAULT_WINDOW_MONTHS));
    let until = parse_month_end(params.until.as_deref()).unwrap_or(until_default);

    if until < from {
        return Err(AppError::BadRequest(
            "`until` must be on or after `from`.".into(),
        ));
    }

    let releases = releases::list_user_calendar(&state.db, user.id, from, until).await?;
    Ok(Json(json!({
        "from": from,
        "until": until,
        "releases": releases,
    })))
}

/// Parse `YYYY-MM` into the first instant of that month in UTC.
/// Returns None for malformed / missing input — the handler then
/// falls back to the default window.
fn parse_month_start(s: Option<&str>) -> Option<DateTime<Utc>> {
    let s = s?.trim();
    if s.is_empty() {
        return None;
    }
    let (year, month) = parse_year_month(s)?;
    let nd = NaiveDate::from_ymd_opt(year, month, 1)?;
    nd.and_hms_opt(0, 0, 0).map(|naive| naive.and_utc())
}

/// Parse `YYYY-MM` into the last instant of that month in UTC.
/// Computed as "first of next month minus 1 second" so end-of-Feb
/// resolves correctly across leap / non-leap years.
fn parse_month_end(s: Option<&str>) -> Option<DateTime<Utc>> {
    let s = s?.trim();
    if s.is_empty() {
        return None;
    }
    let (year, month) = parse_year_month(s)?;
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let next_first = NaiveDate::from_ymd_opt(next_year, next_month, 1)?
        .and_hms_opt(0, 0, 0)?
        .and_utc();
    Some(next_first - Duration::seconds(1))
}

fn parse_year_month(s: &str) -> Option<(i32, u32)> {
    let mut parts = s.splitn(2, '-');
    let year: i32 = parts.next()?.parse().ok()?;
    let month: u32 = parts.next()?.parse().ok()?;
    if !(1..=12).contains(&month) {
        return None;
    }
    Some((year, month))
}

fn start_of_month_utc(t: DateTime<Utc>) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(t.year(), t.month(), 1, 0, 0, 0)
        .single()
        .unwrap_or(t)
}

fn end_of_month_utc(t: DateTime<Utc>) -> DateTime<Utc> {
    let year = t.year();
    let month = t.month();
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    Utc.with_ymd_and_hms(next_year, next_month, 1, 0, 0, 0)
        .single()
        .map(|d| d - Duration::seconds(1))
        .unwrap_or(t)
}

// ── 暦 · Subscribable ICS feed ─────────────────────────────────────────
//
// Three endpoints work as a triplet:
//
//   1. GET /api/user/calendar/ics-url        (auth)
//      Returns the user's stable webcal/https URL for subscription.
//      Mints the secret token lazily on first call.
//
//   2. POST /api/user/calendar/ics-url/regenerate  (auth)
//      Replaces the token with a fresh UUID and returns the new URL.
//      The previous URL stops resolving on the next refresh of any
//      subscriber that holds it.
//
//   3. GET /api/calendar/{token}.ics         (PUBLIC, no session)
//      Serves the VCALENDAR document for the user identified by the
//      token. The token itself is the auth — there's no cookie to
//      send from a calendar app, so the URL has to be guessable
//      only for the user it belongs to. UUID v4 (~122 bits) makes
//      brute-forcing implausible.

/// GET /api/user/calendar/ics-url
///
/// Mints a token on first call (idempotent on subsequent ones) and
/// returns both the absolute URL the user can share with their
/// calendar app and a `webcal://` variant — Apple Calendar accepts
/// either, but Apple's "Subscribe to Calendar" flow auto-picks
/// `webcal://` from the system share sheet.
pub async fn get_ics_url(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let token = users::ensure_calendar_token(&state.db, user.id).await?;
    Ok(Json(build_ics_url_payload(&state.config.frontend_url, &token)))
}

/// POST /api/user/calendar/ics-url/regenerate
///
/// Mints a fresh token regardless of whether one already existed.
/// Returns the same shape as `get_ics_url` so the SPA can swap the
/// displayed URL in place.
pub async fn regenerate_ics_url(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let token = users::regenerate_calendar_token(&state.db, user.id).await?;
    Ok(Json(build_ics_url_payload(&state.config.frontend_url, &token)))
}

/// GET /api/calendar/{token}.ics  (PUBLIC, no auth required).
///
/// The token IS the credential. Wrong / unknown / empty token → 404
/// in every case so an attacker brute-forcing the namespace gets
/// indistinguishable responses for "not minted" / "wrong" /
/// "user deleted".
pub async fn ics_feed_by_token(
    State(state): State<AppState>,
    Path(token_with_ext): Path<String>,
) -> Result<Response, AppError> {
    // The route shape is `{token}.ics` — strip the `.ics` suffix
    // before lookup. axum's path matcher treats the whole segment
    // as the parameter, so we handle the trim here rather than
    // doing it via two routes.
    let token = token_with_ext.strip_suffix(".ics").unwrap_or(&token_with_ext);
    let user = users::find_by_calendar_token(&state.db, token)
        .await?
        .ok_or_else(|| AppError::NotFound("Calendar feed not found".into()))?;

    let ics = calendar_ics::generate_ics(&state.db, &user).await?;

    let response = (
        [
            (
                header::CONTENT_TYPE,
                "text/calendar; charset=utf-8".parse::<http::HeaderValue>().unwrap(),
            ),
            // Same noindex policy as the public profile + poster.
            // The feed is per-user data; search-engine indexing is
            // strictly out of scope.
            (
                header::HeaderName::from_static("x-robots-tag"),
                "noindex, nofollow, noarchive".parse().unwrap(),
            ),
            // 1h client cache. Subscriber clients (Apple Calendar)
            // typically refresh every 15 min anyway; this caps the
            // burst rate without making the feed feel stale.
            (
                header::CACHE_CONTROL,
                "private, max-age=3600".parse().unwrap(),
            ),
        ],
        ics,
    )
        .into_response();
    Ok(response)
}

/// Build the JSON payload returned by both ics-url endpoints.
/// Centralised so the URL shape and the field names stay in sync —
/// the SPA renders both `url` (the canonical https form) and
/// `webcal_url` (Apple's preferred subscription scheme).
fn build_ics_url_payload(frontend_url: &str, token: &str) -> serde_json::Value {
    let url = format!("{}/api/calendar/{}.ics", frontend_url.trim_end_matches('/'), token);
    // webcal:// is just https:// with a different scheme — we strip
    // the leading scheme and slap webcal on. Falls back to https if
    // the frontend URL isn't https (local dev).
    let webcal_url = if let Some(rest) = url.strip_prefix("https://") {
        format!("webcal://{rest}")
    } else if let Some(rest) = url.strip_prefix("http://") {
        format!("webcal://{rest}")
    } else {
        url.clone()
    };
    json!({
        "url": url,
        "webcal_url": webcal_url,
        "token": token,
    })
}
