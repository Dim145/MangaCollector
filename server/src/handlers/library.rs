use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::json;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::models::library::{
    AddCustomRequest, AddFromMangadexRequest, AddLibraryRequest, UpdateVolumesRequest,
};
use crate::services::{cover_pool, library};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
}

/// GET /api/user/library
pub async fn get_user_library(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let entries = library::get_user_library(&state.db, user.id).await?;
    Ok(Json(serde_json::to_value(entries).unwrap()))
}

/// GET /api/user/library/search?q=
pub async fn search_library(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(params): Query<SearchQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let query = params.q.unwrap_or_default();
    let entries = library::search(&state.db, user.id, &query).await?;
    Ok(Json(serde_json::to_value(entries).unwrap()))
}

/// GET /api/user/library/:mal_id
pub async fn get_user_manga(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    let entries = library::get_user_manga(&state.db, mal_id, user.id).await?;
    Ok(Json(serde_json::to_value(entries).unwrap()))
}

/// GET /api/user/library/:mal_id/update-from-mal
pub async fn update_from_mal(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (new_genres, new_name) = library::update_infos_from_mal(
        &state.db,
        &state.http_client,
        state.cache.as_deref(),
        user.id,
        mal_id,
    )
    .await?;

    Ok(Json(json!({
        "success": true,
        "message": "Updated manga info from MAL successfully",
        "new_genres": new_genres,
        "new_name": new_name,
    })))
}

/// POST /api/user/library
pub async fn add_to_library(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(body): Json<AddLibraryRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.mal_id.unwrap_or(0) <= 0 {
        return Err(AppError::BadRequest("Invalid MAL ID".into()));
    }
    library::add_to_user_library(
        &state.db,
        &state.http_client,
        state.cache.as_deref(),
        user.id,
        body,
    )
    .await?;
    Ok(Json(json!({
        "success": true,
        "message": "Added manga to library successfully"
    })))
}

/// POST /api/user/library/mangadex
///
/// Adds a library entry sourced from the MangaDex search flow. Unlike
/// `/library`, this accepts a `mangadex_id` string and mints a negative
/// mal_id internally (same scheme as a custom entry, but the row carries
/// the mangadex_id so it remains refreshable).
pub async fn add_from_mangadex(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(body): Json<AddFromMangadexRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.mangadex_id.trim().is_empty() {
        return Err(AppError::BadRequest("Invalid MangaDex id".into()));
    }
    let entry = library::add_from_mangadex(
        &state.db,
        &state.http_client,
        state.cache.as_deref(),
        user.id,
        body,
    )
    .await?;
    Ok(Json(json!({
        "success": true,
        "message": "Added MangaDex entry to library successfully",
        "newEntry": entry,
    })))
}

/// GET /api/user/library/:mal_id/refresh-from-mangadex
pub async fn refresh_from_mangadex(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (new_genres, new_name, new_image_url_jpg) = library::refresh_from_mangadex(
        &state.db,
        &state.http_client,
        state.cache.as_deref(),
        user.id,
        mal_id,
    )
    .await?;

    Ok(Json(json!({
        "success": true,
        "message": "Refreshed from MangaDex successfully",
        "new_genres": new_genres,
        "new_name": new_name,
        "new_image_url_jpg": new_image_url_jpg,
    })))
}

/// GET /api/user/library/:mal_id/covers
///
/// Returns every alternate cover MAL + MangaDex know about for this series,
/// in a single deduped list. Used by the cover-picker modal on MangaPage.
pub async fn list_covers(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Look up the entry so we know which external ids to query — a
    // MAL-sourced row might also carry a mangadex_id from cross-linking.
    let entries = library::get_user_manga(&state.db, mal_id, user.id).await?;
    let entry = entries
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("Library entry not found".into()))?;

    let covers = cover_pool::fetch_cover_pool(
        &state.http_client,
        state.cache.as_deref(),
        entry.mal_id.filter(|id| *id > 0),
        entry.mangadex_id.as_deref(),
    )
    .await;

    Ok(Json(json!({ "covers": covers })))
}

#[derive(Deserialize)]
pub struct SetPosterRequest {
    pub url: String,
}

/// PATCH /api/user/library/:mal_id/poster
///
/// Set the series' cover to an arbitrary URL — used by the cover-picker.
/// Rejects anything outside our host whitelist (MAL / MangaDex) so the
/// endpoint can't be abused to inject tracking pixels or unrelated hosts.
pub async fn set_poster(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
    Json(body): Json<SetPosterRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !cover_pool::is_whitelisted_poster_url(&body.url) {
        return Err(AppError::BadRequest(
            "URL not allowed — must be an official MAL or MangaDex cover".into(),
        ));
    }

    library::change_poster(&state.db, user.id, mal_id, Some(body.url.clone())).await?;

    Ok(Json(json!({
        "success": true,
        "new_image_url_jpg": body.url,
    })))
}

/// POST /api/user/library/custom
pub async fn add_custom_entry(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(body): Json<AddCustomRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let entry = library::add_custom_entry(
        &state.db,
        &state.http_client,
        state.cache.as_deref(),
        user.id,
        body,
    )
    .await?;
    Ok(Json(json!({
        "success": true,
        "message": "Added custom entry to library successfully",
        "newEntry": entry
    })))
}

/// PATCH /api/user/library/:mal_id  — update volume count
pub async fn update_manga(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
    Json(body): Json<UpdateVolumesRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    library::update_manga_volumes(&state.db, mal_id, user.id, body.volumes).await?;
    Ok(Json(json!({
        "success": true,
        "message": "Updated manga in library successfully"
    })))
}

/// PATCH /api/user/library/:mal_id/:owned  — update owned count
pub async fn update_manga_owned(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path((mal_id, owned)): Path<(i32, i32)>,
) -> Result<Json<serde_json::Value>, AppError> {
    library::update_volumes_owned(&state.db, user.id, mal_id, owned).await?;
    Ok(Json(json!({ "success": true })))
}

/// DELETE /api/user/library/:mal_id
pub async fn delete_manga(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    library::delete_manga(&state.db, mal_id, user.id).await?;
    Ok(Json(json!({
        "success": true,
        "message": "Removed manga from library successfully"
    })))
}
