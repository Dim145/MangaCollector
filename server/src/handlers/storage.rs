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
        Some(url) => !url.starts_with("http"),
        None => false,
    }
}

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
    let data = state
        .storage
        .get(&path)
        .await
        .map_err(AppError::Storage)?;

    let response = (
        [
            (
                header::CONTENT_TYPE,
                "image/jpeg".parse::<http::HeaderValue>().unwrap(),
            ),
            (
                header::CONTENT_DISPOSITION,
                format!("inline; filename=\"{}_poster\"", mal_id)
                    .parse()
                    .unwrap(),
            ),
            (
                header::CACHE_CONTROL,
                "max-age=425061".parse().unwrap(),
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
    // Extract the "poster" field from multipart
    let mut poster_bytes: Option<bytes::Bytes> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
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

    let entries = library::get_user_manga(&state.db, mal_id, user.id).await?;
    let entry = entries
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("Manga not found in user's library".into()))?;

    // Remove existing custom poster before replacing
    if is_custom_poster(entry.image_url_jpg.as_deref()) {
        let old_path = poster_storage_path(user.id, mal_id);
        let _ = state.storage.remove(&old_path).await; // ignore errors on delete
    }

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
        mal_api::get_manga_from_mal(&state.http_client, mal_id)
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
