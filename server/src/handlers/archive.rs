//! 写本 · Archive handlers (export / import).

use axum::{
    extract::State,
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::Utc;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::models::archive::{ImportPreview, ImportRequest};
use crate::services::archive;
use crate::state::AppState;

/// GET /api/user/export.json — the complete portable archive.
/// Streamed as a file download so the browser saves it rather than
/// printing JSON in the tab.
pub async fn export_json(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Response, AppError> {
    let bundle = archive::build_export(&state.db, &user).await?;
    let body = serde_json::to_vec_pretty(&bundle)
        .map_err(|e| AppError::Internal(format!("serialise: {e}")))?;
    Ok(download_response(
        body,
        "application/json",
        &filename_for(&user, "json"),
    ))
}

/// GET /api/user/export.csv — same archive flattened to CSV.
pub async fn export_csv(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Response, AppError> {
    let bundle = archive::build_export(&state.db, &user).await?;
    let csv = archive::build_export_csv(&bundle);
    Ok(download_response(
        csv.into_bytes(),
        "text/csv; charset=utf-8",
        &filename_for(&user, "csv"),
    ))
}

/// POST /api/user/import — merge-mode import. Body:
///   { "dry_run": true, "bundle": <ExportBundle> }
/// Returns an ImportPreview describing what was (or would be) added.
pub async fn import_archive(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(body): Json<ImportRequest>,
) -> Result<Json<ImportPreview>, AppError> {
    let preview =
        archive::apply_import_merge(&state.db, &user, &body.bundle, body.dry_run)
            .await?;
    Ok(Json(preview))
}

/// Common shape for export downloads — sets Content-Disposition so
/// browsers prompt a save dialog with a helpful filename.
fn download_response(bytes: Vec<u8>, mime: &str, filename: &str) -> Response {
    let disposition = format!("attachment; filename=\"{}\"", filename);
    let mime_val =
        HeaderValue::from_str(mime).unwrap_or(HeaderValue::from_static("application/octet-stream"));
    let disposition_val = HeaderValue::from_str(&disposition)
        .unwrap_or(HeaderValue::from_static("attachment"));
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, mime_val),
            (header::CONTENT_DISPOSITION, disposition_val),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static("no-store, max-age=0"),
            ),
        ],
        bytes,
    )
        .into_response()
}

fn filename_for(user: &crate::models::user::User, ext: &str) -> String {
    let slug = user
        .public_slug
        .clone()
        .or_else(|| user.name.clone())
        .unwrap_or_else(|| format!("user-{}", user.id));
    // Keep filename safe for every OS — replace anything suspicious
    // with hyphens.
    let safe: String = slug
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let date = Utc::now().format("%Y%m%d");
    format!("mangacollector-{safe}-{date}.{ext}")
}

