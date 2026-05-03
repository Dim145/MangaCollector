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
use crate::models::author::{AuthorDetail, CreateAuthorRequest, UpdateAuthorRequest};
use crate::services::author;
use crate::services::realtime::SyncKind;
use crate::state::AppState;
use crate::util::image::{self as image_util, ImageFormat};

/// Photo size cap — same shape as the series-poster cap (5 MiB).
/// Author photos are typically 200×300 portraits, well under 1 MiB
/// in practice; the cap is a DoS guard, not a budget for actual
/// content.
const MAX_AUTHOR_PHOTO_SIZE: usize = 5 * 1024 * 1024;

const AUTHOR_PHOTO_FORMATS: &[ImageFormat] =
    &[ImageFormat::Jpeg, ImageFormat::Png, ImageFormat::Webp];

/// `private` cache lifetime for served author photos (5 days). Same
/// reasoning as the poster cache: the URL is stable across users so
/// intermediate caches must not store the response.
const PRIVATE_IMAGE_CACHE_MAX_AGE_SEC: u32 = 60 * 60 * 24 * 5;

/// Storage key shape for custom author photos. Stored under the
/// owning user's namespace so deleting the user (or their custom
/// author) makes the path trivially recoverable for cleanup.
fn author_photo_storage_path(user_id: i32, mal_id: i32) -> String {
    // mal_id is negative for custom authors; we strip the sign in
    // the path so the key reads naturally without filesystem
    // double-dash quirks. The sign is implicit (no shared author
    // ever has a stored photo through this path).
    format!("authors/{}/{}.jpg", user_id, mal_id.unsigned_abs())
}

/// GET /api/authors/{mal_id} — author monograph payload.
///
/// 401 for anonymous; 404 when MAL doesn't know the author or
/// returns no `data`. The `is_custom` flag in the response tells
/// the SPA whether the requesting user can edit/delete it.
pub async fn get_author(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<AuthorDetail>, AppError> {
    if mal_id == 0 {
        return Err(AppError::BadRequest("Invalid author id".into()));
    }
    let detail =
        author::get_or_fetch_author(&state.db, &state.http_client, user.id, mal_id).await?;
    detail
        .map(Json)
        .ok_or_else(|| AppError::NotFound("Author not found".into()))
}

/// POST /api/authors — create a custom author owned by the caller.
///
/// Mints a fresh negative mal_id for the user's custom namespace,
/// stores the supplied name + optional bio, returns the newly-created
/// detail (including the assigned mal_id so the SPA can navigate
/// to it).
pub async fn create_author(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(req): Json<CreateAuthorRequest>,
) -> Result<Json<AuthorDetail>, AppError> {
    let detail = author::create_custom_author(&state.db, user.id, req).await?;
    state.broker.publish(user.id, SyncKind::Authors).await;
    Ok(Json(detail))
}

/// POST /api/authors/{mal_id}/refresh — force re-fetch from Jikan
/// for a shared MAL author, bypassing the 7-day staleness gate.
/// Returns the freshly-pulled detail; rejects negative mal_ids
/// (custom authors have no upstream source).
pub async fn refresh_author(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<AuthorDetail>, AppError> {
    let detail = author::refresh_shared_author(&state.db, &state.http_client, mal_id).await?;
    state.broker.publish(user.id, SyncKind::Authors).await;
    detail
        .map(Json)
        .ok_or_else(|| AppError::NotFound("Author not found on MAL".into()))
}

/// PATCH /api/authors/{mal_id} — edit a custom author's name or bio.
/// Refuses on positive mal_ids (shared MAL rows are read-only).
pub async fn update_author(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
    Json(req): Json<UpdateAuthorRequest>,
) -> Result<Json<AuthorDetail>, AppError> {
    let detail = author::update_custom_author(&state.db, user.id, mal_id, req).await?;
    // Publish both: Authors so the AuthorPage cache evicts AND
    // Library because `LibraryEntry.author` carries an embedded
    // `{ id, mal_id, name }` ref — a name change must propagate
    // to the byline rendered on every series the author was
    // attributed to.
    state.broker.publish(user.id, SyncKind::Authors).await;
    state.broker.publish(user.id, SyncKind::Library).await;
    Ok(Json(detail))
}

/// DELETE /api/authors/{mal_id} — remove the caller's link to this
/// author across every series, plus delete the row + photo for
/// custom authors.
pub async fn delete_author(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    let storage_path = author::delete_author(&state.db, user.id, mal_id).await?;
    if let Some(path) = storage_path {
        // Strip leading `/api/authors/photo/` if the URL we stored
        // was the public-fetch path. The actual storage key is the
        // canonical layout from `author_photo_storage_path`. We can
        // reconstruct it from user + mal_id deterministically since
        // there's at most one photo per custom author.
        let key = author_photo_storage_path(user.id, mal_id);
        if let Err(err) = state.storage.remove(&key).await {
            // Best effort — log + continue. The author row is gone,
            // an orphan photo blob is harmless and trimmed by the
            // operator's storage GC if any.
            tracing::warn!(
                user_id = user.id,
                mal_id,
                %err,
                stored_url = %path,
                "delete_author: storage cleanup failed",
            );
        }
    }
    // Publish both kinds: Authors so the AuthorPage cache evicts,
    // Library because deleting an author NULLs `user_libraries.author_id`
    // for every series of THIS user that referenced it.
    state.broker.publish(user.id, SyncKind::Authors).await;
    state.broker.publish(user.id, SyncKind::Library).await;
    Ok(Json(json!({ "ok": true })))
}

/// POST /api/authors/{mal_id}/photo — upload a custom author's
/// portrait. Multipart with a single `photo` field; refuses positive
/// mal_ids (no overrides on shared MAL rows for v1).
pub async fn upload_author_photo(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
    mut multipart: Multipart,
) -> Result<Json<AuthorDetail>, AppError> {
    if mal_id >= 0 {
        return Err(AppError::BadRequest(
            "Photo uploads are only allowed on custom authors.".into(),
        ));
    }

    // Bound the field-count budget like the poster handler does.
    const MAX_FIELDS_SCANNED: usize = 8;
    let mut photo_bytes: Option<bytes::Bytes> = None;
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
            photo_bytes = Some(
                field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(e.to_string()))?,
            );
            break;
        }
    }
    let data = photo_bytes.ok_or_else(|| AppError::BadRequest("No photo uploaded".into()))?;

    if data.is_empty() {
        return Err(AppError::BadRequest("Photo file is empty".into()));
    }
    if data.len() > MAX_AUTHOR_PHOTO_SIZE {
        return Err(AppError::BadRequest(format!(
            "Photo file too large ({} bytes); max {} bytes",
            data.len(),
            MAX_AUTHOR_PHOTO_SIZE
        )));
    }
    // Magic-byte content-type check — same shape as the poster path.
    if !image_util::is_supported(&data, AUTHOR_PHOTO_FORMATS) {
        return Err(AppError::BadRequest(
            "Unsupported image format (expected JPEG/PNG/WEBP)".into(),
        ));
    }

    let path = author_photo_storage_path(user.id, mal_id);
    state
        .storage
        .put(&path, data)
        .await
        .map_err(|e| AppError::Internal(format!("storage write: {e}")))?;

    // Public URL the SPA can hit. We expose it via a dedicated
    // /photo/ route so the cache/CDN policy stays explicit; the
    // path matches what `delete_author` reconstructs above.
    let public_url = format!("/api/authors/{}/photo", mal_id);
    let detail =
        author::set_custom_photo_url(&state.db, user.id, mal_id, Some(public_url)).await?;
    state.broker.publish(user.id, SyncKind::Authors).await;
    Ok(Json(detail))
}

/// DELETE /api/authors/{mal_id}/photo — remove the custom photo
/// without deleting the author row itself.
pub async fn delete_author_photo(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<AuthorDetail>, AppError> {
    if mal_id >= 0 {
        return Err(AppError::BadRequest(
            "Only custom author photos can be cleared.".into(),
        ));
    }
    let key = author_photo_storage_path(user.id, mal_id);
    let _ = state.storage.remove(&key).await;
    let detail = author::set_custom_photo_url(&state.db, user.id, mal_id, None).await?;
    state.broker.publish(user.id, SyncKind::Authors).await;
    Ok(Json(detail))
}

/// GET /api/authors/{mal_id}/photo — serve a custom author's photo.
/// Authenticated + scoped to the caller's namespace; refuses
/// positive mal_ids (shared rows always carry an external image_url
/// directly, no proxy needed).
pub async fn get_author_photo(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Response, AppError> {
    if mal_id >= 0 {
        return Err(AppError::NotFound("Photo not available".into()));
    }
    let stored = author::current_photo_path(&state.db, user.id, mal_id).await?;
    if stored.is_none() {
        return Err(AppError::NotFound("Photo not set".into()));
    }
    let key = author_photo_storage_path(user.id, mal_id);
    let data = state
        .storage
        .get(&key)
        .await
        .map_err(|_| AppError::NotFound("Photo not set".into()))?;
    // Detect format from bytes — the path uses `.jpg` for layout
    // simplicity but uploads accept JPEG/PNG/WebP.
    let content_type = image_util::detect(&data)
        .map(ImageFormat::content_type)
        .unwrap_or("image/jpeg");
    let cache_control = format!("private, max-age={}", PRIVATE_IMAGE_CACHE_MAX_AGE_SEC);
    let response = (
        [
            (
                header::CONTENT_TYPE,
                http::HeaderValue::from_str(content_type)
                    .map_err(|e| AppError::Internal(format!("content-type header: {e}")))?,
            ),
            (
                // `private` because the author photo is authenticated
                // — same rationale as poster cache headers in
                // handlers/storage.rs. ~5 day TTL covers most edits
                // without staling forever.
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
