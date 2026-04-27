//! 暦 · ICS calendar feed generator (RFC 5545).
//!
//! Produces a VCALENDAR document containing one VEVENT per upcoming
//! tome the user follows. Subscribed via the public
//! `/api/calendar/{token}.ics` handler — Apple Calendar / Google
//! Calendar / Outlook all consume the same shape.
//!
//! Design notes:
//!
//! - **All-day events**, not timed. Manga release dates are inherently
//!   day-precision (publishers ship "on Sept 12", not "at 09:00 JST").
//!   `DTSTART;VALUE=DATE` + `DTEND;VALUE=DATE` keep the events as
//!   bounded all-day blocks rather than midnight-to-midnight slots in
//!   the user's timezone, which would visually crowd surrounding days.
//!
//! - **Stable UIDs**: `mc-vol-{user_id}-{mal_id}-{vol_num}@mangacollector`.
//!   This means a date push from the publisher updates the same VEVENT
//!   in the user's calendar instead of duplicating, which is exactly
//!   what the RFC's UID semantics require for SEQUENCE / refresh.
//!
//! - **Forward-only window**: 12 months from today. Past releases are
//!   dropped (the user's calendar already remembers them, and the feed
//!   is meant to be a *forward* schedule). 12 months matches the
//!   horizon of `discover_upcoming` so the feed never tries to surface
//!   a date the cascade can't supply.
//!
//! - **Plain ASCII**: no rich text, no HTML in description. Some
//!   subscriber clients (Apple Calendar pre-15) render `<a>` tags
//!   verbatim; we emit a plain URL line and let the client linkify.
//!
//! - **Line folding**: RFC 5545 mandates folding long content lines
//!   at 75 octets with a leading-whitespace continuation. We fold all
//!   user-supplied content (series names, descriptions) so a long
//!   title doesn't violate the spec.

use chrono::{DateTime, Datelike, Duration, Timelike, Utc};

use crate::db::Db;
use crate::errors::AppError;
use crate::models::user::User;
use crate::services::releases;

/// Calendar product identifier emitted in `PRODID`. RFC 5545 mandates
/// a unique vendor / product label so subscriber clients can attribute
/// events back to the source. The slashes follow the convention used
/// by Apple / Microsoft (`-//Vendor//Product VERSION//EN`).
const PRODID: &str = concat!(
    "-//MangaCollector//upcoming-volumes ",
    env!("CARGO_PKG_VERSION"),
    "//EN"
);

/// Forward window of the feed.
const HORIZON_DAYS: i64 = 365;

/// Produce a fully-formed VCALENDAR string for the given user.
///
/// The handler caller has already authenticated this user via the
/// secret token (the public URL contains the token, which maps 1:1
/// to a user). We trust the caller to have done that — this
/// function only knows about a user_id and a calendar.
///
/// On success, returns a CRLF-terminated string suitable for a
/// `Content-Type: text/calendar; charset=utf-8` response.
pub async fn generate_ics(db: &Db, user: &User) -> Result<String, AppError> {
    let now = Utc::now();
    let until = now + Duration::days(HORIZON_DAYS);
    let entries = releases::list_user_calendar(db, user.id, now, until).await?;

    let mut buf = String::with_capacity(512 + entries.len() * 256);
    buf.push_str("BEGIN:VCALENDAR\r\n");
    buf.push_str("VERSION:2.0\r\n");
    write_folded(&mut buf, "PRODID", PRODID);
    buf.push_str("CALSCALE:GREGORIAN\r\n");
    buf.push_str("METHOD:PUBLISH\r\n");
    write_folded(
        &mut buf,
        "X-WR-CALNAME",
        &format!(
            "MangaCollector · {}",
            user.name.as_deref().unwrap_or("Upcoming volumes"),
        ),
    );
    buf.push_str(
        "X-WR-CALDESC:Upcoming manga-volume releases tracked in MangaCollector\r\n",
    );

    for entry in entries {
        let start = entry.release_date;
        // All-day events end on the *next* day (DTEND is exclusive
        // for VALUE=DATE per RFC 5545 §3.6.1).
        let end = start + Duration::days(1);

        let uid = format!(
            "mc-vol-{}-{}-{}@mangacollector",
            user.id, entry.mal_id, entry.vol_num
        );

        buf.push_str("BEGIN:VEVENT\r\n");
        write_folded(&mut buf, "UID", &uid);
        buf.push_str(&format!(
            "DTSTAMP:{}\r\n",
            format_ics_datetime_utc(now)
        ));
        buf.push_str(&format!(
            "DTSTART;VALUE=DATE:{}\r\n",
            format_ics_date(start)
        ));
        buf.push_str(&format!(
            "DTEND;VALUE=DATE:{}\r\n",
            format_ics_date(end)
        ));

        let summary = format!("{} — Tome {}", entry.manga_name, entry.vol_num);
        write_folded(&mut buf, "SUMMARY", &escape_text(&summary));

        let mut description = String::new();
        description.push_str(&format!(
            "Upcoming volume tracked in MangaCollector.\\n\\nSeries: {}\\nVolume: {}\\nRelease: {}",
            escape_text(&entry.manga_name),
            entry.vol_num,
            format_ics_date_human(start)
        ));
        if let Some(isbn) = entry.release_isbn.as_deref() {
            description.push_str(&format!("\\nISBN: {}", escape_text(isbn)));
        }
        if !entry.origin.is_empty() && entry.origin != "manual" {
            description
                .push_str(&format!("\\nSource: {}", escape_text(&entry.origin)));
        }
        if let Some(url) = entry.release_url.as_deref() {
            description.push_str(&format!("\\nPre-order: {}", escape_text(url)));
        }
        write_folded(&mut buf, "DESCRIPTION", &description);

        if let Some(url) = entry.release_url.as_deref() {
            // RFC 5545 URL property — Apple/Google surface this as
            // a clickable link in the event detail view.
            write_folded(&mut buf, "URL", url);
        }

        // Transparent so subscribers can stack other events on the
        // same day without "busy" conflicts. A book-release event
        // isn't a meeting; it shouldn't block focus time.
        buf.push_str("TRANSP:TRANSPARENT\r\n");
        buf.push_str("CLASS:PRIVATE\r\n");
        buf.push_str("END:VEVENT\r\n");
    }

    buf.push_str("END:VCALENDAR\r\n");
    Ok(buf)
}

/// Format `YYYYMMDD` for `DTSTART;VALUE=DATE` etc. Date is written in
/// UTC so cross-timezone subscribers see the same day — the publisher
/// announced "Sept 12", we don't want a JST-based Apple Calendar to
/// flip it to "Sept 11" via implicit local-tz conversion.
fn format_ics_date(d: DateTime<Utc>) -> String {
    format!("{:04}{:02}{:02}", d.year(), d.month(), d.day())
}

/// Format `YYYYMMDDTHHMMSSZ` for `DTSTAMP`. Always UTC.
fn format_ics_datetime_utc(d: DateTime<Utc>) -> String {
    format!(
        "{:04}{:02}{:02}T{:02}{:02}{:02}Z",
        d.year(),
        d.month(),
        d.day(),
        d.hour(),
        d.minute(),
        d.second(),
    )
}

/// Human-readable date used inside DESCRIPTION (not subject to RFC's
/// strict format — purely informational).
fn format_ics_date_human(d: DateTime<Utc>) -> String {
    let month = match d.month() {
        1 => "Jan",
        2 => "Feb",
        3 => "Mar",
        4 => "Apr",
        5 => "May",
        6 => "Jun",
        7 => "Jul",
        8 => "Aug",
        9 => "Sep",
        10 => "Oct",
        11 => "Nov",
        12 => "Dec",
        _ => "?",
    };
    format!("{} {}, {}", month, d.day(), d.year())
}

/// Escape text content per RFC 5545 §3.3.11. Keeps subscriber clients
/// from misinterpreting commas / semicolons / newlines as property
/// separators. We DO NOT escape backslashes here because the only
/// backslashes we emit are the ones we deliberately wrote (for `\n`
/// line breaks in DESCRIPTION).
fn escape_text(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace('\n', "\\n")
}

/// Append `NAME:VALUE\r\n` with RFC 5545 line folding — wraps the
/// content at 75 octets with a leading SP continuation on the next
/// line. We measure octets via `len()` on the byte representation so
/// multi-byte UTF-8 characters don't accidentally split mid-rune.
///
/// The `value` is assumed to already be `escape_text`'d when needed.
fn write_folded(buf: &mut String, name: &str, value: &str) {
    let line = format!("{name}:{value}");
    let bytes = line.as_bytes();
    if bytes.len() <= 75 {
        buf.push_str(&line);
        buf.push_str("\r\n");
        return;
    }
    // First line: 75 bytes, subsequent: " " + up to 74 bytes.
    let mut start = 0;
    let mut first = true;
    while start < bytes.len() {
        let limit = if first { 75 } else { 74 };
        // Walk back from `start + limit` until we land on a UTF-8
        // boundary so we never split a multi-byte rune. `is_char_boundary`
        // is fast-path on ASCII (every offset is a boundary) and only
        // costs anything on the rare non-ASCII title.
        let mut end = (start + limit).min(bytes.len());
        while end < bytes.len() && !line.is_char_boundary(end) {
            end -= 1;
        }
        if !first {
            buf.push(' ');
        }
        buf.push_str(&line[start..end]);
        buf.push_str("\r\n");
        start = end;
        first = false;
    }
}
