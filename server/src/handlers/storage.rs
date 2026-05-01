use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::header,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::services::{library, mal_api};
use crate::state::AppState;

fn poster_storage_path(user_id: i32, mal_id: i32) -> String {
    format!("uploads/images/{}/{}.jpg", user_id, mal_id)
}

fn is_custom_poster(image_url: Option<&str>) -> bool {
    match image_url {
        // "Custom" = not an external http(s) URL. Delegates to the
        // shared helper so every site uses the same definition and we
        // can't drift apart over time.
        Some(url) => !crate::services::library::is_external_http_url(url),
        None => false,
    }
}

/// Validate a poster's bytes by magic-number inspection.
///
/// We trust neither the `Content-Type` header (client-controlled) nor
/// the file extension (there isn't one). The only source of truth is
/// the file's bytes themselves. We accept the three image codecs the
/// frontend actually renders:
///
///   • JPEG — `FF D8 FF`
///   • PNG  — `89 50 4E 47 0D 0A 1A 0A`
///   • WebP — `RIFF xxxx WEBP`
///
/// Everything else (HTML/JS, SVG with embedded scripts, executables,
/// archives…) is rejected with 400. The served Content-Type is always
/// `image/jpeg` via `get_poster`, so even if a malicious upload
/// sneaked through, browsers wouldn't execute it — but we defend in
/// depth, because bucket pollution alone (storing attacker-controlled
/// binaries) is undesirable.
fn is_supported_image(bytes: &[u8]) -> bool {
    // JPEG: starts with FF D8 FF
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return true;
    }
    // PNG: fixed 8-byte signature
    const PNG_SIG: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if bytes.len() >= 8 && bytes[..8] == PNG_SIG {
        return true;
    }
    // WebP: "RIFF" ........ "WEBP"
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return true;
    }
    false
}

/// Maximum size for a single poster upload, in bytes. The global HTTP
/// body limit (main.rs) covers CSV imports so it's at 10 MiB by
/// default; posters should be much smaller. 5 MiB is generous enough
/// for a high-res cover scan.
const MAX_POSTER_SIZE: usize = 5 * 1024 * 1024;

/// GET /api/user/storage/poster/:mal_id
pub async fn get_poster(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Response, AppError> {
    let entries = library::get_user_manga(&state.db, mal_id, user.id).await?;
    let entry = entries
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("Manga not found in user's library".into()))?;

    if !is_custom_poster(entry.image_url_jpg.as_deref()) {
        return Err(AppError::NotFound(
            "No custom poster found for this manga".into(),
        ));
    }

    let path = poster_storage_path(user.id, mal_id);
    // When the DB says "custom poster" but the blob is actually missing
    // from storage (old state, manual bucket cleanup, failed import,
    // lost S3 object…), two things happen without this handling:
    //
    //   1. Every page visit fires a 500 that pollutes the error logs.
    //   2. The frontend's CoverImage keeps hitting the URL, fails, and
    //      falls back to the 巻 placeholder — but never *fixes* the
    //      broken state in the DB.
    //
    // The fix turns the situation into a clean 404 (semantically
    // accurate: the blob doesn't exist), and self-heals the library
    // row so the next visit knows this is no longer a custom poster
    // and falls back to the MAL CDN URL for MAL-sourced series.
    let data = match state.storage.get(&path).await {
        Ok(bytes) => bytes,
        Err(err) => {
            tracing::warn!(
                user_id = user.id,
                mal_id,
                error = %err,
                "storage: custom poster blob missing, self-healing library row"
            );
            // Restore an external MAL cover when possible; otherwise
            // clear the URL so the UI falls back to the placeholder.
            let fallback = if mal_id > 0 {
                mal_api::get_manga_from_mal(
                    &state.http_client,
                    state.cache.as_deref(),
                    mal_id,
                )
                .await
                .ok()
                .flatten()
                .and_then(|d| d.images)
                .and_then(|i| i.jpg)
                .and_then(|j| j.large_image_url)
            } else {
                None
            };
            let _ = library::change_poster(&state.db, user.id, mal_id, fallback).await;
            return Err(AppError::NotFound(
                "Custom poster blob missing (library row healed)".into(),
            ));
        }
    };

    // `format!()` for content-disposition keeps the dynamic mal_id; the
    // static headers use `from_static` to avoid the runtime parse + the
    // ergonomic `.unwrap()` panic site, which clippy flags otherwise.
    let disposition = format!("inline; filename=\"{}_poster\"", mal_id)
        .parse()
        .map_err(|e| AppError::Internal(format!("disposition header: {e}")))?;
    let response = (
        [
            (
                header::CONTENT_TYPE,
                http::HeaderValue::from_static("image/jpeg"),
            ),
            (header::CONTENT_DISPOSITION, disposition),
            (
                // `private` is critical: the URL `/api/user/storage/
                // poster/{mal_id}` is stable across users (two users who
                // both have a custom poster for the same MAL id produce
                // the same URL string), so without `private` an upstream
                // proxy (Traefik, CDN, corporate gateway) could share a
                // cached response across sessions and serve user A's
                // cover to user B. `private` forbids intermediate caches
                // from storing the response — only the end-user's
                // browser keeps it, scoped to their own session.
                header::CACHE_CONTROL,
                http::HeaderValue::from_static("private, max-age=425061"),
            ),
        ],
        Body::from(data),
    )
        .into_response();

    Ok(response)
}

/// POST /api/user/storage/poster/:mal_id
pub async fn upload_poster(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    // Extract the "poster" field from multipart. Bound the number of
    // unrelated fields we'll scan past before giving up — a malformed
    // or malicious client could ship hundreds of empty/unrelated
    // fields ahead of the poster (or no poster at all) just to keep
    // the connection open and burn one of our worker slots. The body
    // size limit caps the byte budget; this caps the field-count
    // budget on top.
    const MAX_FIELDS_SCANNED: usize = 8;
    let mut poster_bytes: Option<bytes::Bytes> = None;
    let mut scanned = 0usize;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        scanned += 1;
        if scanned > MAX_FIELDS_SCANNED {
            return Err(AppError::BadRequest(
                "Too many multipart fields; expected `poster`".into(),
            ));
        }
        if field.name() == Some("poster") {
            poster_bytes = Some(
                field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(e.to_string()))?,
            );
            break;
        }
    }

    let data = poster_bytes.ok_or_else(|| AppError::BadRequest("No files uploaded".into()))?;

    // Size & content-type validation BEFORE any S3 interaction.
    // Cheap checks that short-circuit obvious abuse before we spend
    // network bandwidth on an upload to storage.
    if data.is_empty() {
        return Err(AppError::BadRequest("Poster file is empty".into()));
    }
    if data.len() > MAX_POSTER_SIZE {
        return Err(AppError::BadRequest(format!(
            "Poster file too large ({} bytes); max {} bytes",
            data.len(),
            MAX_POSTER_SIZE
        )));
    }
    if !is_supported_image(&data) {
        return Err(AppError::BadRequest(
            "Poster must be a JPEG, PNG, or WebP image".into(),
        ));
    }

    let entries = library::get_user_manga(&state.db, mal_id, user.id).await?;
    let _entry = entries
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("Manga not found in user's library".into()))?;

    // Atomic replace. S3 PUT overwrites the key in place — a new
    // upload lands at exactly the same path as the previous one
    // (`uploads/images/{user}/{mal_id}.jpg`), so there's nothing to
    // remove first. The previous "remove-then-put" ordering created a
    // window where a put failure would leave the user without their
    // previous cover AND without a new one. By dropping the preemptive
    // remove, a failed put simply leaves the old cover intact.
    let path = poster_storage_path(user.id, mal_id);
    state
        .storage
        .put(&path, data)
        .await
        .map_err(AppError::Storage)?;

    let poster_api_path = format!("/api/user/storage/poster/{}", mal_id);
    library::change_poster(&state.db, user.id, mal_id, Some(poster_api_path.clone())).await?;

    Ok(Json(json!({
        "success": true,
        "message": "File uploaded successfully",
        "filePath": path,
    })))
}

/// DELETE /api/user/storage/poster/:mal_id
pub async fn delete_poster(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    let entries = library::get_user_manga(&state.db, mal_id, user.id).await?;
    let entry = entries
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("Manga not found in user's library".into()))?;

    if !is_custom_poster(entry.image_url_jpg.as_deref()) {
        return Err(AppError::NotFound(
            "No custom poster found for this manga".into(),
        ));
    }

    let path = poster_storage_path(user.id, mal_id);
    state
        .storage
        .remove(&path)
        .await
        .map_err(AppError::Storage)?;

    // Restore original MAL image URL
    let mal_poster = if mal_id > 0 {
        mal_api::get_manga_from_mal(&state.http_client, state.cache.as_deref(), mal_id)
            .await
            .ok()
            .flatten()
            .and_then(|d| d.images)
            .and_then(|i| i.jpg)
            .and_then(|j| j.large_image_url)
    } else {
        None
    };

    library::change_poster(&state.db, user.id, mal_id, mal_poster.clone()).await?;

    Ok(Json(json!({
        "success": true,
        "message": "Poster deleted successfully",
        "malPoster": mal_poster,
    })))
}
