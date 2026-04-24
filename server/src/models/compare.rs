//! 対照 · Compare — payload shapes for the "/u/{slug} vs me" diff.
//!
//! Two users, three buckets: shared (series in both libraries),
//! mine_only, their_only. Payload stays metadata-only — no
//! per-volume details, no prices, no dates — so the same DTO can
//! later power a fully-public `/api/compare/{a}/{b}` endpoint
//! without a schema shuffle.

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct CompareResponse {
    pub me: CompareUser,
    pub other: CompareUser,
    pub shared: Vec<CompareEntry>,
    pub mine_only: Vec<CompareEntry>,
    pub their_only: Vec<CompareEntry>,
}

#[derive(Debug, Serialize)]
pub struct CompareUser {
    pub slug: Option<String>,
    pub display_name: String,
    pub hanko: String,
    pub series_count: i64,
    pub volumes_owned: i64,
}

/// Enough metadata for a mini-card grid. We take whichever version of
/// the row carries art (mine vs theirs can differ — custom covers).
#[derive(Debug, Serialize)]
pub struct CompareEntry {
    pub mal_id: Option<i32>,
    pub name: String,
    pub image_url_jpg: Option<String>,
    pub volumes: i32,
    pub genres: Vec<String>,
}
