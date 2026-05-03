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
use crate::services::realtime::SyncKind;
use crate::services::snapshot;
use crate::state::AppState;
use crate::util::image::{self as image_util, ImageFormat};

/// Image cap — 5 MiB. The shelf renderer produces ~600 KB PNGs in
/// practice; the cap is a DoS guard, not a budget.
const MAX_SNAPSHOT_IMAGE_SIZE: usize = 5 * 1024 * 1024;

/// `private` cache lifetime for served snapshots (5 days). See the
/// comment in `handlers/storage.rs` for why intermediate caches must
/// not store these responses.
const PRIVATE_IMAGE_CACHE_MAX_AGE_SEC: u32 = 60 * 60 * 24 * 5;

const SNAPSHOT_FORMATS: &[ImageFormat] = &[ImageFormat::Png, ImageFormat::Jpeg];

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
    state.broker.publish(user.id, SyncKind::Snapshots).await;
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
    state.broker.publish(user.id, SyncKind::Snapshots).await;
    Ok(Json(json!({ "ok": true })))
}

pub async fn upload_snapshot_image(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<i32>,
    mut multipart: Multipart,
) -> Result<Json<SnapshotResponse>, AppError> {
    // Verify ownership BEFORE accepting the upload — saves us a
    // wasted multipart parse + an orphan S3 blob on bogus / cross-
    // user ids. `exists_for_user` is a COUNT(*) query (cheap, no
    // row hydration) scoped by (id, user_id), so it returns false
    // both for a non-existent id AND for a row that belongs to
    // another user.
    if !snapshot::exists_for_user(&state.db, user.id, id).await? {
        return Err(AppError::NotFound("Snapshot not found".into()));
    }

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
    if !image_util::is_supported(&data, SNAPSHOT_FORMATS) {
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
    state.broker.publish(user.id, SyncKind::Snapshots).await;
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
    // Detect format from bytes — uploads accept PNG OR JPEG, so the
    // served Content-Type can't be hard-coded.
    let content_type = image_util::detect(&data)
        .map(ImageFormat::content_type)
        .unwrap_or("image/png");
    let cache_control = format!("private, max-age={}", PRIVATE_IMAGE_CACHE_MAX_AGE_SEC);
    let response = (
        [
            (
                header::CONTENT_TYPE,
                http::HeaderValue::from_str(content_type)
                    .map_err(|e| AppError::Internal(format!("content-type header: {e}")))?,
            ),
            (
                header::CACHE_CONTROL,
                http::HeaderValue::from_str(&cache_control)
                    .map_err(|e| AppError::Internal(format!("cache-control header: {e}")))?,
            ),
        ],
        Body::from(data),
    )
        .into_response();
    Ok(response)
}
