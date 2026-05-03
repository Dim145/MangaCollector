//! 印影 Inei · Snapshot history model.
//!
//! A `user_snapshots` row is the frozen state of one user's library
//! at the moment of capture. Stats are denormalised so listing the
//! gallery doesn't trigger a recompute over the live library on
//! every render. The rendered shelf PNG (1080×1350) lives in S3
//! under a per-user key, referenced by `image_path`.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "user_snapshots")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub user_id: i32,
    pub name: String,
    pub notes: Option<String>,
    pub total_volumes: i32,
    pub total_owned: i32,
    pub series_count: i32,
    pub series_complete: i32,
    pub image_path: Option<String>,
    pub taken_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

/// API response shape — same fields as Model with a `has_image`
/// computed flag so the frontend can decide whether to render the
/// thumbnail vs. a stats-only card.
#[derive(Debug, Clone, Serialize)]
pub struct SnapshotResponse {
    pub id: i32,
    pub name: String,
    pub notes: Option<String>,
    pub total_volumes: i32,
    pub total_owned: i32,
    pub series_count: i32,
    pub series_complete: i32,
    pub has_image: bool,
    pub taken_at: chrono::DateTime<chrono::Utc>,
}

impl From<Model> for SnapshotResponse {
    fn from(m: Model) -> Self {
        SnapshotResponse {
            id: m.id,
            name: m.name,
            notes: m.notes,
            total_volumes: m.total_volumes,
            total_owned: m.total_owned,
            series_count: m.series_count,
            series_complete: m.series_complete,
            has_image: m.image_path.is_some(),
            taken_at: m.taken_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateSnapshotRequest {
    /// Free-text label. Trimmed + clamped to `SNAPSHOT_NAME_MAX_LEN`.
    pub name: String,
    /// Optional commentary. Trimmed + clamped to
    /// `SNAPSHOT_NOTES_MAX_LEN`. Empty post-trim folds to None.
    #[serde(default)]
    pub notes: Option<String>,
}

/// Cap on the snapshot label. 120 chars holds a comfortable
/// description ("Avant la purge Glénat de novembre 2026") without
/// letting megabytes into the column.
pub const SNAPSHOT_NAME_MAX_LEN: usize = 120;
/// Cap on the notes blob. 2 000 chars matches the volume note cap —
/// roomy enough for a paragraph or two of context.
pub const SNAPSHOT_NOTES_MAX_LEN: usize = 2000;
