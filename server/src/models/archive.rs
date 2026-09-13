//! 写本 · Archive (export / import) bundle types.
//!
//! The export bundle is a single JSON blob that a user can download to
//! archive their collection or port it to another instance. The shape
//! is deliberately flat and human-readable — if a maintainer needs to
//! tweak one volume by hand before re-importing, they can open the
//! file in any text editor and find what they're looking for.
//!
//! Contract:
//!   • `version` is bumped whenever the schema changes in a
//!     backwards-incompatible way. The importer rejects anything it
//!     doesn't know.
//!   • Every timestamp is ISO-8601 UTC.
//!   • Prices are decimals (not floats) to preserve exact cents.
//!   • The `user.email` is omitted from exports by default — the
//!     archive should be safe to share.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

/// v1 — series, per-volume ownership/price/store/collector/read/notes,
///      coffret names and ranges.
/// v2 — everything the data model actually holds: publisher, edition,
///      review (+ visibility) and author on a series; loans and
///      upcoming-release fields on a volume; the coffret `collector`
///      flag; and coffret MEMBERSHIP is restored on import (by range).
///      Every new field is `serde(default)`, so a v1 file still imports.
pub const EXPORT_VERSION: u32 = 2;

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportBundle {
    pub version: u32,
    pub exported_at: chrono::DateTime<chrono::Utc>,
    pub source: String,
    pub user: ExportUser,
    pub settings: Option<ExportSettings>,
    pub library: Vec<ExportSeries>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportUser {
    pub name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportSettings {
    pub currency: String,
    #[serde(rename = "titleType")]
    pub title_type: Option<String>,
    pub adult_content_level: i32,
    pub theme: Option<String>,
    pub language: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportSeries {
    pub mal_id: Option<i32>,
    pub mangadex_id: Option<String>,
    pub name: String,
    pub volumes: i32,
    pub volumes_owned: i32,
    pub image_url_jpg: Option<String>,
    pub genres: Vec<String>,
    // ── v2 ──
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edition: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review: Option<String>,
    #[serde(default)]
    pub review_public: bool,
    /// Author NAME. Authors are a shared table keyed by id; ids are
    /// meaningless across instances, so the bundle carries the text and
    /// the importer resolves it the way the edit form does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// Row timestamps. Carried so a restore keeps "date added" and the
    /// recency lenses honest; a bundle without them (v1) gets "now".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_on: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_on: Option<chrono::DateTime<chrono::Utc>>,
    // ── v2 · reading progression ──
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reading_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_reading_at: Option<chrono::NaiveDate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_reading_at: Option<chrono::NaiveDate>,
    #[serde(default)]
    pub times_read: i32,
    pub volumes_detail: Vec<ExportVolume>,
    pub coffrets: Vec<ExportCoffret>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportVolume {
    pub vol_num: i32,
    pub owned: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store: Option<String>,
    #[serde(default)]
    pub collector: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Personal note — preserved through export/import round-trips.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Advisory. Coffret identity is recomputed on import (new serial
    /// ids); membership is restored from each coffret's vol_start..=
    /// vol_end range in the per-series `coffrets[]` array, so this flag
    /// only tells a human reader which rows belong to a box set.
    #[serde(default)]
    pub in_coffret: bool,
    // ── v2 · upcoming / announced release ──
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_date: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_isbn: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_url: Option<String>,
    /// `manual` / scraper origin tag. `None` on import keeps the DB default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub announced_at: Option<chrono::DateTime<chrono::Utc>>,
    // ── v2 · loan ──
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loaned_to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loan_started_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loan_due_at: Option<chrono::DateTime<chrono::Utc>>,
    /// 友 · Public slug of a linked borrower. Ids are meaningless across
    /// instances; the importer re-links by slug when that user exists
    /// here and is followed, and keeps the text handle otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loaned_to_slug: Option<String>,
    // ── v2 · physical copy ──
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub condition: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(default)]
    pub extra_copies: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bought_at: Option<chrono::NaiveDate>,
    // ── v2 · row timestamps ──
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_on: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_on: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportCoffret {
    pub name: String,
    pub vol_start: i32,
    pub vol_end: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store: Option<String>,
    // ── v2 · row timestamps ──
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_on: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_on: Option<chrono::DateTime<chrono::Utc>>,
}

/// Shape returned by POST /api/user/import when `dryRun=true`, and also
/// folded into the real-run response so the UI can summarise after
/// applying too. All counts are scoped to the merge behaviour:
///   • `added` — series not previously present (by mal_id).
///   • `skipped_conflict` — series whose mal_id is already in the user's
///     library. Existing rows are left untouched in merge mode.
///   • `skipped_invalid` — malformed entries (missing name, etc.).
#[derive(Debug, Serialize, Default)]
pub struct ImportPreview {
    pub total_in_file: usize,
    pub added: usize,
    /// Series that were already present and were swapped for the
    /// bundle's version (`mode = replace` only; always 0 in merge mode).
    #[serde(default)]
    pub replaced: usize,
    pub skipped_conflict: usize,
    pub skipped_invalid: usize,
    pub added_series: Vec<ImportAddedSummary>,
    pub conflict_series: Vec<ImportAddedSummary>,
}

#[derive(Debug, Serialize)]
pub struct ImportAddedSummary {
    pub mal_id: Option<i32>,
    pub name: String,
    pub volumes: i32,
    pub owned_volumes: usize,
}

/// Request body for POST /api/user/import.
#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    #[serde(default)]
    pub dry_run: bool,
    /// `merge` (default) leaves a series that is already in the library
    /// untouched; `replace` swaps it — volumes and coffrets included —
    /// for the bundle's version. `replace` is what "restore my backup"
    /// means on the account the backup came from.
    #[serde(default)]
    pub mode: ImportMode,
    pub bundle: ExportBundle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportMode {
    #[default]
    Merge,
    Replace,
}

#[cfg(test)]
mod wire_tests {
    use super::*;

    const V1_SERIES: &str = r#"{
        "mal_id": 2, "mangadex_id": null, "name": "Berserk", "volumes": 41,
        "volumes_owned": 3, "image_url_jpg": null, "genres": ["Action"],
        "volumes_detail": [{"vol_num": 1, "owned": true, "read_at": null}],
        "coffrets": [{"name": "Box", "vol_start": 1, "vol_end": 3}]
    }"#;

    #[test]
    fn a_v1_series_still_deserialises_with_the_v2_fields_defaulted() {
        let s: ExportSeries = serde_json::from_str(V1_SERIES).unwrap();
        assert_eq!(s.publisher, None);
        assert_eq!(s.author, None);
        assert!(!s.review_public);
        let v = &s.volumes_detail[0];
        assert_eq!(v.loaned_to, None);
        assert_eq!(v.release_date, None);
        assert_eq!(v.origin, None);
    }

    #[test]
    fn v2_fields_round_trip_and_absent_options_are_omitted() {
        let mut s: ExportSeries = serde_json::from_str(V1_SERIES).unwrap();
        s.publisher = Some("Glénat".into());
        s.author = Some("Kentaro Miura".into());
        s.review_public = true;
        s.volumes_detail[0].loaned_to = Some("Alex".into());
        s.volumes_detail[0].release_isbn = Some("9782505011514".into());
        let json = serde_json::to_string(&s).unwrap();
        // `None` options are skipped, so a v2 file stays as lean as v1.
        assert!(!json.contains("\"edition\""));
        assert!(!json.contains("\"loan_due_at\""));
        let back: ExportSeries = serde_json::from_str(&json).unwrap();
        assert_eq!(back.publisher.as_deref(), Some("Glénat"));
        assert_eq!(back.author.as_deref(), Some("Kentaro Miura"));
        assert!(back.review_public);
        assert_eq!(back.volumes_detail[0].loaned_to.as_deref(), Some("Alex"));
        assert_eq!(
            back.volumes_detail[0].release_isbn.as_deref(),
            Some("9782505011514")
        );
    }

    #[test]
    fn import_mode_defaults_to_merge_and_parses_replace() {
        let req: ImportRequest = serde_json::from_str(
            r#"{"bundle":{"version":1,"exported_at":"2026-01-01T00:00:00Z","source":"x","user":{"name":null},"settings":null,"library":[]}}"#,
        )
        .unwrap();
        assert_eq!(req.mode, ImportMode::Merge);
        assert!(!req.dry_run);
        let req: ImportRequest = serde_json::from_str(
            r#"{"mode":"replace","dry_run":true,"bundle":{"version":2,"exported_at":"2026-01-01T00:00:00Z","source":"x","user":{"name":null},"settings":null,"library":[]}}"#,
        )
        .unwrap();
        assert_eq!(req.mode, ImportMode::Replace);
        assert!(req.dry_run);
    }

    #[test]
    fn preview_serialises_the_replaced_counter() {
        let p = ImportPreview {
            total_in_file: 1,
            added: 0,
            replaced: 1,
            skipped_conflict: 0,
            skipped_invalid: 0,
            added_series: vec![],
            conflict_series: vec![],
        };
        let v: serde_json::Value = serde_json::to_value(&p).unwrap();
        assert_eq!(v["replaced"], 1);
    }
}
