//! 印影 Inei · Snapshot handlers.
//!
//! Five endpoints:
//!   • GET    /api/user/snapshots       — list (newest first)
//!   • POST   /api/user/snapshots       — capture stats (no image yet)
//!   • DELETE /api/user/snapshots/{id}  — remove row + image
//!   • POST   /api/user/snapshots/{id}/image  — multipart upload
//!   • GET    /api/user/snapshots/{id}/image  — serve PNG to caller
//!
//! Storage path matches author photo layout: `snapshots/{user_id}/{id}.png`.

use axum::{
    Json,
    body::Body,
    extract::{Multipart, Path, State},
    http::header,
    response::{IntoResponse, Response},
};
use serde_json::json;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::models::snapshot::{CreateSnapshotRequest, SnapshotResponse};
use crate::services::snapshot;
use crate::state::AppState;

/// Image cap — 5 MiB. The shelf renderer produces ~600 KB PNGs in
/// practice; the cap is a DoS guard, not a budget.
const MAX_SNAPSHOT_IMAGE_SIZE: usize = 5 * 1024 * 1024;

fn snapshot_image_storage_path(user_id: i32, snapshot_id: i32) -> String {
    format!("snapshots/{}/{}.png", user_id, snapshot_id)
}

pub async fn list_snapshots(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<Vec<SnapshotResponse>>, AppError> {
    let rows = snapshot::list_for_user(&state.db, user.id).await?;
    Ok(Json(rows))
}

pub async fn create_snapshot(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(req): Json<CreateSnapshotRequest>,
) -> Result<Json<SnapshotResponse>, AppError> {
    let res = snapshot::create(&state.db, user.id, req).await?;
    Ok(Json(res))
}

pub async fn delete_snapshot(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    let stored = snapshot::delete(&state.db, user.id, id).await?;
    if stored.is_some() {
        // The path on the row was the public-fetch URL; reconstruct
        // the canonical storage key from (user_id, id).
        let key = snapshot_image_storage_path(user.id, id);
        if let Err(err) = state.storage.remove(&key).await {
            tracing::warn!(
                user_id = user.id,
                snapshot_id = id,
                %err,
                "delete_snapshot: storage cleanup failed"
            );
        }
    }
    Ok(Json(json!({ "ok": true })))
}

pub async fn upload_snapshot_image(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<i32>,
    mut multipart: Multipart,
) -> Result<Json<SnapshotResponse>, AppError> {
    // Verify ownership BEFORE accepting the upload — saves us a
    // wasted multipart parse on cross-user attempts.
    snapshot::current_image_path(&state.db, user.id, id)
        .await?
        .map(|_| ())
        .or(Some(()))
        .ok_or_else(|| AppError::NotFound("Snapshot not found".into()))?;

    const MAX_FIELDS_SCANNED: usize = 8;
    let mut bytes_opt: Option<bytes::Bytes> = None;
    let mut scanned = 0usize;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        scanned += 1;
        if scanned > MAX_FIELDS_SCANNED {
            return Err(AppError::BadRequest(
                "Too many multipart fields; expected `image`".into(),
            ));
        }
        if field.name() == Some("image") {
            bytes_opt = Some(
                field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(e.to_string()))?,
            );
            break;
        }
    }
    let data = bytes_opt.ok_or_else(|| AppError::BadRequest("No image uploaded".into()))?;
    if data.is_empty() {
        return Err(AppError::BadRequest("Image file is empty".into()));
    }
    if data.len() > MAX_SNAPSHOT_IMAGE_SIZE {
        return Err(AppError::BadRequest(format!(
            "Image too large ({} bytes); max {} bytes",
            data.len(),
            MAX_SNAPSHOT_IMAGE_SIZE
        )));
    }
    if !is_supported_png_or_jpeg(&data) {
        return Err(AppError::BadRequest(
            "Unsupported image format (expected PNG or JPEG)".into(),
        ));
    }

    let key = snapshot_image_storage_path(user.id, id);
    state
        .storage
        .put(&key, data)
        .await
        .map_err(|e| AppError::Internal(format!("storage write: {e}")))?;
    let public_url = format!("/api/user/snapshots/{}/image", id);
    let res = snapshot::set_image_path(&state.db, user.id, id, Some(public_url)).await?;
    Ok(Json(res))
}

pub async fn get_snapshot_image(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<i32>,
) -> Result<Response, AppError> {
    let stored = snapshot::current_image_path(&state.db, user.id, id).await?;
    if stored.is_none() {
        return Err(AppError::NotFound("Snapshot image not set".into()));
    }
    let key = snapshot_image_storage_path(user.id, id);
    let data = state
        .storage
        .get(&key)
        .await
        .map_err(|_| AppError::NotFound("Snapshot image not set".into()))?;
    let response = (
        [
            (
                header::CONTENT_TYPE,
                http::HeaderValue::from_static("image/png"),
            ),
            (
                header::CACHE_CONTROL,
                http::HeaderValue::from_static("private, max-age=425061"),
            ),
        ],
        Body::from(data),
    )
        .into_response();
    Ok(response)
}

/// Magic-byte check for the snapshot image. Accepts PNG (the
/// canonical output of `shelfSnapshot.js`) and JPEG (in case a
/// future export defaults to a smaller / lossy variant).
fn is_supported_png_or_jpeg(data: &[u8]) -> bool {
    if data.len() < 8 {
        return false;
    }
    if data.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        return true; // PNG
    }
    if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return true; // JPEG
    }
    false
}
