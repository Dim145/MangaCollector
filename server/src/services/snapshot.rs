//! 印影 Inei · Snapshot history service.
//!
//! Three responsibilities:
//!
//! 1. CAPTURE — `create` computes the user's current library stats
//!    in one pass (mirroring the seal-stat aggregator) and inserts a
//!    `user_snapshots` row with denormalised counts.
//!
//! 2. LISTING — `list_for_user` returns every snapshot the caller
//!    has captured, newest first.
//!
//! 3. CLEANUP — `delete` removes a row + its S3 image blob.
//!
//! The actual rendered shelf PNG (1080×1350) is uploaded separately
//! via the multipart photo handler — the create flow leaves
//! `image_path = NULL` so the SPA can capture stats first, then
//! attach the image when the canvas finishes drawing.
//!
//! Storage layout: `snapshots/{user_id}/{snapshot_id}.png`. Same
//! shape as the author photo path so the operator's GC can sweep
//! both with one rule.

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set,
};

use crate::db::Db;
use crate::errors::AppError;
use crate::models::library::{self, Entity as LibraryEntity};
use crate::models::snapshot::{
    self, ActiveModel, CreateSnapshotRequest, Entity as SnapshotEntity, Model, SnapshotResponse,
    SNAPSHOT_NAME_MAX_LEN, SNAPSHOT_NOTES_MAX_LEN,
};

fn sanitize_label(value: Option<String>, max: usize) -> Option<String> {
    let v = value?.trim().to_string();
    if v.is_empty() {
        return None;
    }
    Some(v.chars().take(max).collect())
}

fn sanitize_required_label(raw: &str, max: usize) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("Snapshot name is required.".into()));
    }
    Ok(trimmed.chars().take(max).collect())
}

/// Compute denormalised library stats for the snapshot. Cheaper than
/// rebuilding the seal stats since we don't need genre / collector /
/// reading axes — just the four headline counts.
async fn compute_capture_stats(
    db: &Db,
    user_id: i32,
) -> Result<(i32, i32, i32, i32), AppError> {
    let rows = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .all(db)
        .await
        .map_err(AppError::from)?;
    let mut total_volumes: i32 = 0;
    let mut total_owned: i32 = 0;
    let mut series_count: i32 = 0;
    let mut series_complete: i32 = 0;
    for r in &rows {
        series_count += 1;
        total_volumes = total_volumes.saturating_add(r.volumes);
        total_owned = total_owned.saturating_add(r.volumes_owned);
        if r.volumes > 0 && r.volumes_owned >= r.volumes {
            series_complete += 1;
        }
    }
    Ok((total_volumes, total_owned, series_count, series_complete))
}

/// Capture a new snapshot. Sanitises the user-supplied label/notes
/// and writes the row with `image_path = NULL`. The image upload
/// rides on a separate POST route so the SPA can capture stats
/// optimistically while the canvas finishes drawing.
pub async fn create(
    db: &Db,
    user_id: i32,
    req: CreateSnapshotRequest,
) -> Result<SnapshotResponse, AppError> {
    let name = sanitize_required_label(&req.name, SNAPSHOT_NAME_MAX_LEN)?;
    let notes = sanitize_label(req.notes, SNAPSHOT_NOTES_MAX_LEN);
    let (total_volumes, total_owned, series_count, series_complete) =
        compute_capture_stats(db, user_id).await?;

    let now = Utc::now();
    let model = ActiveModel {
        user_id: Set(user_id),
        name: Set(name),
        notes: Set(notes),
        total_volumes: Set(total_volumes),
        total_owned: Set(total_owned),
        series_count: Set(series_count),
        series_complete: Set(series_complete),
        image_path: Set(None),
        taken_at: Set(now),
        ..Default::default()
    };
    let inserted = model.insert(db).await.map_err(AppError::from)?;
    Ok(inserted.into())
}

pub async fn list_for_user(
    db: &Db,
    user_id: i32,
) -> Result<Vec<SnapshotResponse>, AppError> {
    let rows = SnapshotEntity::find()
        .filter(snapshot::Column::UserId.eq(user_id))
        .order_by_desc(snapshot::Column::TakenAt)
        .all(db)
        .await
        .map_err(AppError::from)?;
    Ok(rows.into_iter().map(SnapshotResponse::from).collect())
}

/// Delete a snapshot row + return the storage path of its image
/// (if any) so the handler can clean up the blob. Same scoping as
/// the other delete paths: the (id, user_id) filter is the
/// horizontal-authz gate.
pub async fn delete(
    db: &Db,
    user_id: i32,
    id: i32,
) -> Result<Option<String>, AppError> {
    let row = SnapshotEntity::find()
        .filter(snapshot::Column::Id.eq(id))
        .filter(snapshot::Column::UserId.eq(user_id))
        .one(db)
        .await
        .map_err(AppError::from)?;
    let Some(row) = row else {
        return Ok(None);
    };
    let path = row.image_path.clone();
    SnapshotEntity::delete_many()
        .filter(snapshot::Column::Id.eq(id))
        .filter(snapshot::Column::UserId.eq(user_id))
        .exec(db)
        .await
        .map_err(AppError::from)?;
    Ok(path)
}

/// Update the `image_path` column after the multipart upload lands.
/// Refuses on non-existent or cross-user rows (returns NotFound).
pub async fn set_image_path(
    db: &Db,
    user_id: i32,
    id: i32,
    new_path: Option<String>,
) -> Result<SnapshotResponse, AppError> {
    let row = SnapshotEntity::find()
        .filter(snapshot::Column::Id.eq(id))
        .filter(snapshot::Column::UserId.eq(user_id))
        .one(db)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound("Snapshot not found".into()))?;
    let mut active: ActiveModel = row.into();
    active.image_path = Set(new_path);
    let updated = active.update(db).await.map_err(AppError::from)?;
    Ok(updated.into())
}

/// Look up the storage key (image_path) for a snapshot owned by the
/// caller. Used by the GET image route to enforce the per-user
/// scoping before reaching the storage backend.
pub async fn current_image_path(
    db: &Db,
    user_id: i32,
    id: i32,
) -> Result<Option<String>, AppError> {
    let row: Option<Model> = SnapshotEntity::find()
        .filter(snapshot::Column::Id.eq(id))
        .filter(snapshot::Column::UserId.eq(user_id))
        .one(db)
        .await
        .map_err(AppError::from)?;
    Ok(row.and_then(|r| r.image_path))
}
