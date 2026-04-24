//! 外部輸入 · Handlers that turn an external service input (username
//! or UUID) into an `ExportBundle` the client can then feed through
//! the regular archive-import flow.
//!
//! Each endpoint returns `{ bundle, preview }`:
//!   • `bundle` is the transformed payload (safe to re-POST to
//!     `/api/user/import` for the actual commit).
//!   • `preview` is the dry-run result so the client can render the
//!     "N to add · M conflicts" chips without a second round-trip.

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::models::archive::{ExportBundle, ImportPreview};
use crate::services::{archive, external_import};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ExternalUsernameRequest {
    pub username: String,
}

#[derive(Debug, Deserialize)]
pub struct ExternalListRequest {
    pub input: String,
}

/// Yamtrack CSV — the client reads the file and posts it as a plain
/// string. Simpler than multipart for our size class (CSVs stay under
/// a few hundred KB even for large libraries).
#[derive(Debug, Deserialize)]
pub struct ExternalCsvRequest {
    pub csv: String,
}

#[derive(Debug, Serialize)]
pub struct ExternalImportResponse {
    pub bundle: ExportBundle,
    pub preview: ImportPreview,
}

async fn finalise_preview(
    state: &AppState,
    user: &crate::models::user::User,
    bundle: ExportBundle,
) -> Result<ExternalImportResponse, AppError> {
    let preview =
        archive::apply_import_merge(&state.db, user, &bundle, true).await?;
    Ok(ExternalImportResponse { bundle, preview })
}

/// POST /api/user/import/external/mal
pub async fn import_mal(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(body): Json<ExternalUsernameRequest>,
) -> Result<Json<ExternalImportResponse>, AppError> {
    let bundle =
        external_import::fetch_mal_by_username(&state.http_client, &body.username)
            .await?;
    let out = finalise_preview(&state, &user, bundle).await?;
    Ok(Json(out))
}

/// POST /api/user/import/external/anilist
pub async fn import_anilist(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(body): Json<ExternalUsernameRequest>,
) -> Result<Json<ExternalImportResponse>, AppError> {
    let bundle = external_import::fetch_anilist_by_username(
        &state.http_client,
        &body.username,
    )
    .await?;
    let out = finalise_preview(&state, &user, bundle).await?;
    Ok(Json(out))
}

/// POST /api/user/import/external/mangadex
pub async fn import_mangadex(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(body): Json<ExternalListRequest>,
) -> Result<Json<ExternalImportResponse>, AppError> {
    let bundle =
        external_import::fetch_mangadex_by_input(&state.http_client, &body.input)
            .await?;
    let out = finalise_preview(&state, &user, bundle).await?;
    Ok(Json(out))
}

/// POST /api/user/import/external/yamtrack — Yamtrack CSV upload.
///
/// The client reads the CSV locally, POSTs it as a JSON string. We
/// parse, filter to manga rows, map into our bundle format, then run
/// the standard dry-run preview. No network calls — Yamtrack CSVs are
/// self-contained so this endpoint is fast and rate-limit-free.
pub async fn import_yamtrack(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(body): Json<ExternalCsvRequest>,
) -> Result<Json<ExternalImportResponse>, AppError> {
    let bundle = external_import::parse_yamtrack_csv(&body.csv)?;
    let out = finalise_preview(&state, &user, bundle).await?;
    Ok(Json(out))
}
