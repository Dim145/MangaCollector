//! 棚 · `/api/user/locations` — the places registry.
//!
//! Writes go through `services::ops::locations`, which owns the realtime
//! fan-out; see that module's header for why.
use axum::{
    Json,
    body::Body,
    extract::{Multipart, Path, State},
    http::header,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::handlers::realtime::ClientId;
use crate::models::location::Model as Location;
use crate::services::locations::{self, LocationPatch, LocationsResponse};
use crate::services::ops;
use crate::state::AppState;
use crate::util::image::{self as image_util, ImageFormat};

/// 写 · What a phone camera produces after the client has scaled it
/// down. Five times over budget means the client skipped that step, and
/// the answer is an error the developer can read, not a 12 MP shelf.
const MAX_PHOTO_SIZE: usize = 4 * 1024 * 1024;

const PHOTO_FORMATS: &[ImageFormat] = &[ImageFormat::Jpeg, ImageFormat::Png, ImageFormat::Webp];

/// Same five days the poster and author-photo handlers use. `private`
/// matters as much here: `/api/user/locations/3/photo` is the same
/// string for every user who happens to have a place with id 3.
const PRIVATE_IMAGE_CACHE_MAX_AGE_SEC: u32 = 60 * 60 * 24 * 5;

#[derive(Debug, Deserialize)]
pub struct CreateLocationRequest {
    pub name: String,
    #[serde(default)]
    pub note: Option<String>,
}

/// GET /api/user/locations — every place with its tome count, plus the
/// number of owned tomes filed nowhere.
pub async fn list(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<LocationsResponse>, AppError> {
    Ok(Json(locations::list(&state.db, user.id).await?))
}

/// POST /api/user/locations — create (or fetch) a place by name.
pub async fn create(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    Json(body): Json<CreateLocationRequest>,
) -> Result<Json<Location>, AppError> {
    let row = ops::locations::create(&state, user.id, &body.name, body.note, client_id).await?;
    Ok(Json(row))
}

/// PATCH /api/user/locations/{id} — rename (moves its tomes), annotate,
/// reorder.
pub async fn update(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    Path(id): Path<i64>,
    Json(body): Json<LocationPatch>,
) -> Result<Json<Location>, AppError> {
    let row = ops::locations::update(&state, user.id, id, body, client_id).await?;
    Ok(Json(row))
}

/// DELETE /api/user/locations/{id} — the place goes, its tomes stay and
/// are unfiled.
pub async fn remove(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cleared = ops::locations::remove(&state, user.id, id, client_id).await?;
    Ok(Json(json!({ "success": true, "unfiled": cleared })))
}

/// GET /api/user/locations/{id}/photo — the shelf itself.
pub async fn get_photo(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<i64>,
) -> Result<Response, AppError> {
    // Reading the row is also the ownership check: it 404s on a place
    // that is not this user's, which is what a stranger should see.
    if locations::photo_taken_at(&state.db, user.id, id)
        .await?
        .is_none()
    {
        return Err(AppError::NotFound("This place has no photo.".into()));
    }
    let key = locations::photo_storage_path(user.id, id);
    let data = match state.storage.get(&key).await {
        Ok(bytes) => bytes,
        Err(err) => {
            // The stamp says there is a photo and the blob is gone.
            // Clear the stamp so the page stops asking, and answer 404
            // rather than 500 — nothing here is the reader's fault.
            tracing::warn!(user_id = user.id, location_id = id, %err, "place photo blob missing");
            let _ = locations::set_photo(&state.db, user.id, id, None).await;
            return Err(AppError::NotFound("Place photo blob missing.".into()));
        }
    };
    let content_type = image_util::detect(&data)
        .map(ImageFormat::content_type)
        .unwrap_or("image/jpeg");
    let cache_control = format!("private, max-age={PRIVATE_IMAGE_CACHE_MAX_AGE_SEC}");
    Ok((
        [
            (
                header::CONTENT_TYPE,
                axum::http::HeaderValue::from_str(content_type)
                    .map_err(|e| AppError::Internal(format!("content-type header: {e}")))?,
            ),
            (
                header::CACHE_CONTROL,
                axum::http::HeaderValue::from_str(&cache_control)
                    .map_err(|e| AppError::Internal(format!("cache-control header: {e}")))?,
            ),
        ],
        Body::from(data),
    )
        .into_response())
}

/// POST /api/user/locations/{id}/photo — multipart, one `photo` field.
pub async fn upload_photo(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    Path(id): Path<i64>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    // Bound the field-count budget the way the poster handler does: a
    // client can otherwise hold a worker open with hundreds of empty
    // fields that never contain the photo.
    const MAX_FIELDS_SCANNED: usize = 8;
    let mut photo: Option<bytes::Bytes> = None;
    let mut scanned = 0usize;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        scanned += 1;
        if scanned > MAX_FIELDS_SCANNED {
            return Err(AppError::BadRequest(
                "Too many multipart fields; expected `photo`".into(),
            ));
        }
        if field.name() == Some("photo") {
            photo = Some(
                field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(e.to_string()))?,
            );
            break;
        }
    }
    let data = photo.ok_or_else(|| AppError::BadRequest("No photo uploaded".into()))?;
    if data.is_empty() {
        return Err(AppError::BadRequest("Photo file is empty".into()));
    }
    if data.len() > MAX_PHOTO_SIZE {
        return Err(AppError::BadRequest(format!(
            "Photo too large ({} bytes); max {} bytes",
            data.len(),
            MAX_PHOTO_SIZE
        )));
    }
    if !image_util::is_supported(&data, PHOTO_FORMATS) {
        return Err(AppError::BadRequest(
            "Photo must be a JPEG, PNG or WebP image".into(),
        ));
    }
    let url = ops::locations::set_photo(&state, user.id, id, Some(data), client_id).await?;
    Ok(Json(json!({ "success": true, "photo_url": url })))
}

/// DELETE /api/user/locations/{id}/photo
pub async fn delete_photo(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, AppError> {
    ops::locations::set_photo(&state, user.id, id, None, client_id).await?;
    Ok(Json(
        json!({ "success": true, "photo_url": serde_json::Value::Null }),
    ))
}
