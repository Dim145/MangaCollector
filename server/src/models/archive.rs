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

pub const EXPORT_VERSION: u32 = 1;

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
    /// Preserved so the import can restore coffret grouping. Coffret
    /// identity is recomputed on import (new serial IDs) but the link
    /// between a volume and its coffret's NAME is preserved via the
    /// per-series `coffrets[]` array below — NOT through this field.
    #[serde(default)]
    pub in_coffret: bool,
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
    pub bundle: ExportBundle,
}
