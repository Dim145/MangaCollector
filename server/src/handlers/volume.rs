//! 巻 · `/api/user/volume` — volume tracking, loans, physical copies.
//!
//! Writes go through `services::ops::volume`, which owns the realtime
//! fan-out; see that module's header for why.
use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;
use serde_json::json;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::handlers::realtime::ClientId;
use crate::models::volume::{UpdateVolumeRequest, Volume};
use crate::services::ops;
use crate::services::volume;
use crate::state::AppState;

/// Body for `POST /api/user/library/{mal_id}/volumes/upcoming` and
/// `PATCH /api/user/volume/{id}/upcoming`. Same shape, both paths.
#[derive(Debug, Deserialize)]
pub struct UpcomingVolumeRequest {
    pub vol_num: Option<i32>,
    pub release_date: chrono::DateTime<chrono::Utc>,
    #[serde(default)]
    pub release_isbn: Option<String>,
    #[serde(default)]
    pub release_url: Option<String>,
}

impl UpcomingVolumeRequest {
    /// Split the announce-side fields off the wire type. `vol_num` is
    /// not one of them — the edit path has no use for it.
    fn details(self) -> ops::volume::UpcomingDetails {
        ops::volume::UpcomingDetails {
            release_date: self.release_date,
            release_isbn: self.release_isbn,
            release_url: self.release_url,
        }
    }
}

/// GET /api/user/volume
pub async fn get_all_volumes(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<Vec<Volume>>, AppError> {
    let volumes = volume::get_all_for_user(&state.db, user.id).await?;
    Ok(Json(volumes))
}

/// Body for `POST /api/user/library/{mal_id}/volumes/bulk-mark`.
/// Both fields are optional — passing neither is a no-op. Passing
/// `read: false` clears the read timestamp; `read: true` stamps now.
#[derive(Debug, Deserialize)]
pub struct BulkMarkRequest {
    #[serde(default)]
    pub owned: Option<bool>,
    #[serde(default)]
    pub read: Option<bool>,
}

/// POST /api/user/library/{mal_id}/volumes/bulk-mark
///
/// Cascade `owned` / `read` to every released volume of the series in
/// one round-trip. Powers the dashboard's bulk-actions bar — the
/// alternative (PATCH per volume from the client) would be ~30 calls
/// per series and forces the client to first fetch the volume list.
pub async fn bulk_mark_volumes(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    Path(mal_id): Path<i32>,
    Json(body): Json<BulkMarkRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    ops::volume::bulk_mark_volumes(&state, user.id, mal_id, body.owned, body.read, client_id)
        .await?;
    Ok(Json(json!({ "status": "ok" })))
}

/// GET /api/user/volume/:mal_id
pub async fn get_volumes_by_id(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<Vec<Volume>>, AppError> {
    let volumes = volume::get_all_for_user_by_mal_id(&state.db, user.id, mal_id).await?;
    Ok(Json(volumes))
}

/// POST /api/user/library/:mal_id/volumes/upcoming — manually create
/// an upcoming-volume row for this series.
pub async fn add_upcoming_volume(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    Path(mal_id): Path<i32>,
    Json(body): Json<UpcomingVolumeRequest>,
) -> Result<Json<Volume>, AppError> {
    let vol_num = body.vol_num;
    let inserted = ops::volume::add_upcoming_volume(
        &state,
        user.id,
        mal_id,
        vol_num,
        body.details(),
        client_id,
    )
    .await?;
    Ok(Json(inserted))
}

/// PATCH /api/user/volume/:id/upcoming — edit announce-side fields of
/// a manually-created upcoming row. Refused on API-origin rows.
pub async fn update_upcoming_volume(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    Path(id): Path<i32>,
    Json(body): Json<UpcomingVolumeRequest>,
) -> Result<Json<Volume>, AppError> {
    let updated =
        ops::volume::update_upcoming_volume(&state, user.id, id, body.details(), client_id).await?;
    Ok(Json(updated))
}

/// DELETE /api/user/volume/:id — remove a manually-created upcoming
/// row. Refused on API-origin rows (the sweep would resurrect them).
pub async fn delete_volume(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    ops::volume::delete_volume(&state, user.id, id, client_id).await?;
    Ok(Json(json!({
        "success": true,
        "message": "Volume deleted successfully"
    })))
}

/// PATCH /api/user/volume
pub async fn update_volume(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    Json(body): Json<UpdateVolumeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    ops::volume::update_volume(&state, user.id, body, client_id).await?;
    Ok(Json(json!({
        "success": true,
        "message": "Volume updated successfully"
    })))
}

/// GET /api/user/volume/loans — list every volume currently lent by
/// the caller (drives the dashboard "outstanding loans" widget).
/// Empty array when nothing is lent — never 404.
pub async fn list_loans(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<Vec<crate::models::volume::ActiveLoan>>, AppError> {
    let loans = volume::list_active_loans(&state.db, user.id).await?;
    Ok(Json(loans))
}

/// GET /api/user/volume/loans/history?limit=&mal_id= — the loan ledger,
/// newest first: every tome ever lent, with who had it and when it came
/// back. Drives the widget's history tab and the borrower suggestions.
#[derive(Debug, Deserialize)]
pub struct LoanHistoryQuery {
    pub limit: Option<u64>,
    pub mal_id: Option<i32>,
}

pub async fn list_loan_history(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    axum::extract::Query(q): axum::extract::Query<LoanHistoryQuery>,
) -> Result<Json<Vec<crate::models::loan_history::Model>>, AppError> {
    let rows =
        crate::services::loan_history::list(&state.db, user.id, q.mal_id, q.limit.unwrap_or(200))
            .await?;
    Ok(Json(rows))
}

/// GET /api/user/volume/loans/export.csv?from=YYYY-MM-DD&to=YYYY-MM-DD —
/// the ledger as a spreadsheet (lend date bounded inclusively).
#[derive(Debug, Deserialize)]
pub struct LoanExportQuery {
    pub from: Option<chrono::NaiveDate>,
    pub to: Option<chrono::NaiveDate>,
}

pub async fn export_loans_csv(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    axum::extract::Query(q): axum::extract::Query<LoanExportQuery>,
) -> Result<axum::response::Response, AppError> {
    let rows = crate::services::loan_history::all_for_export(&state.db, user.id).await?;
    let csv = crate::services::loan_history::to_csv(&rows, q.from, q.to, chrono::Utc::now());
    Ok(crate::handlers::archive::download_response(
        csv.into_bytes(),
        "text/csv; charset=utf-8",
        &crate::handlers::archive::download_filename(&user, Some("loans"), "csv"),
    ))
}

/// GET /api/user/volume/loans/borrowed — every volume a friend has
/// lent to the caller: the other side of `list_loans`. Empty array
/// when nothing is borrowed — never 404.
pub async fn list_borrowed(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<Vec<crate::models::volume::BorrowedVolume>>, AppError> {
    let rows = volume::list_borrowed(&state.db, user.id).await?;
    Ok(Json(rows))
}
