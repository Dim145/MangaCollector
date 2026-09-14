//! 蔵 · `/api/user/library` — the series collection.
//!
//! Writes go through `services::ops::library`, which owns the validation
//! and the realtime fan-out; see that module's header for why.
use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;
use serde_json::json;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::handlers::realtime::ClientId;
use crate::models::library::{
    AddCustomRequest, AddFromMangadexRequest, AddLibraryRequest, LibraryEntry, UpdateLibraryRequest,
};
use crate::services::{cover_pool, library, ops};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
}

/// GET /api/user/library
pub async fn get_user_library(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<Vec<LibraryEntry>>, AppError> {
    let entries = library::get_user_library(&state.db, user.id).await?;
    Ok(Json(entries))
}

/// GET /api/user/library/search?q=
pub async fn search_library(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(params): Query<SearchQuery>,
) -> Result<Json<Vec<LibraryEntry>>, AppError> {
    let query = params.q.unwrap_or_default();
    let entries = library::search(&state.db, user.id, &query).await?;
    Ok(Json(entries))
}

/// GET /api/user/library/:mal_id
pub async fn get_user_manga(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<Vec<LibraryEntry>>, AppError> {
    let entries = library::get_user_manga(&state.db, mal_id, user.id).await?;
    Ok(Json(entries))
}

/// GET /api/user/library/:mal_id/update-from-mal
pub async fn update_from_mal(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    Path(mal_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (new_genres, new_name) =
        ops::library::update_from_mal(&state, user.id, mal_id, client_id).await?;
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
    ClientId(client_id): ClientId,
    Json(body): Json<AddLibraryRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    ops::library::add_to_library(&state, user.id, body, client_id).await?;
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
    ClientId(client_id): ClientId,
    Json(body): Json<AddFromMangadexRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let entry = ops::library::add_from_mangadex(&state, user.id, body, client_id).await?;
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
    ClientId(client_id): ClientId,
    Path(mal_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (new_genres, new_name, new_image_url_jpg) =
        ops::library::refresh_from_mangadex(&state, user.id, mal_id, client_id).await?;
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

/// GET /api/user/library/:mal_id/volume-covers
///
/// Per-volume cover URLs keyed by volume number. Used by MangaPage to show
/// the matching cover on each Volume card. MangaDex-only (MAL doesn't
/// publish per-volume covers); returns an empty object for series without
/// a MangaDex cross-reference.
pub async fn list_volume_covers(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    let entries = library::get_user_manga(&state.db, mal_id, user.id).await?;
    let entry = entries
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("Library entry not found".into()))?;

    let covers = cover_pool::fetch_volume_covers(
        &state.http_client,
        state.cache.as_deref(),
        entry.mangadex_id.as_deref(),
    )
    .await;

    // Stringify keys for the JSON shape the client expects.
    let payload: serde_json::Map<String, serde_json::Value> = covers
        .into_iter()
        .map(|(k, v)| (k.to_string(), serde_json::Value::String(v)))
        .collect();

    Ok(Json(json!({ "covers": payload })))
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
    ClientId(client_id): ClientId,
    Path(mal_id): Path<i32>,
    Json(body): Json<SetPosterRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let url = body.url.clone();
    ops::library::set_poster(&state, user.id, mal_id, body.url, client_id).await?;
    Ok(Json(json!({
        "success": true,
        "new_image_url_jpg": url,
    })))
}

/// POST /api/user/library/custom
pub async fn add_custom_entry(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    Json(body): Json<AddCustomRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let entry = ops::library::add_custom_entry(&state, user.id, body, client_id).await?;
    Ok(Json(json!({
        "success": true,
        "message": "Added custom entry to library successfully",
        "newEntry": entry
    })))
}

/// PATCH /api/user/library/:mal_id  — partial update of a library row.
///
/// Accepts any subset of `volumes`, `publisher`, `edition`. Each field
/// is honoured only when present in the request body. The volumes path
/// (which mutates `user_volumes` alongside the count) runs first so the
/// publisher / edition write lands on the freshly-rebuilt row.
pub async fn update_manga(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    Path(mal_id): Path<i32>,
    Json(body): Json<UpdateLibraryRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    ops::library::update_manga(&state, user.id, mal_id, body, client_id).await?;
    Ok(Json(json!({
        "success": true,
        "message": "Updated manga in library successfully"
    })))
}

/// POST /api/user/library/:mal_id/reread — 再読 · start the series over:
/// one more read-through on the tally, every tome back to unread,
/// status `reading` from today.
pub async fn start_reread(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    Path(mal_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    ops::library::start_reread(&state, user.id, mal_id, client_id).await?;
    Ok(Json(json!({
        "success": true,
        "message": "Reading the series again"
    })))
}

/// PATCH /api/user/library/:mal_id/:owned  — update owned count
pub async fn update_manga_owned(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    Path((mal_id, owned)): Path<(i32, i32)>,
) -> Result<Json<serde_json::Value>, AppError> {
    ops::library::update_manga_owned(&state, user.id, mal_id, owned, client_id).await?;
    Ok(Json(json!({ "success": true })))
}

/// DELETE /api/user/library/:mal_id
pub async fn delete_manga(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    Path(mal_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    ops::library::delete_manga(&state, user.id, mal_id, client_id).await?;
    Ok(Json(json!({
        "success": true,
        "message": "Removed manga from library successfully"
    })))
}

/// POST /api/user/library/{mal_id}/refresh-upcoming
///
/// 来 · On-demand discovery + reconcile of upcoming volumes for a
/// single series. Walks the API cascade (Phase 1: MangaUpdates only)
/// and writes any newly-announced tomes into `user_volumes` with
/// `release_date` populated, `owned/read/collector` zeroed, and
/// `origin` set to the source. Updates in place when a known date
/// has shifted; never touches rows the user marked as `manual`.
///
/// Returns a small report so the SPA can render a "X added · Y
/// updated" toast; SPA also uses it to decide whether to refetch
/// the volume list (added or updated > 0 → `SyncKind::Volumes` hits
/// every connected device).
pub async fn refresh_upcoming(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    Path(mal_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    let outcome = ops::library::refresh_upcoming(&state, user.id, mal_id, client_id).await?;
    Ok(Json(json!({
        "success": true,
        "added": outcome.report.added,
        "updated": outcome.report.updated,
        "skipped": outcome.report.skipped,
        "discovered_count": outcome.discovered_count,
    })))
}
