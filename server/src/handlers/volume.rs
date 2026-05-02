use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use serde_json::json;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::models::volume::UpdateVolumeRequest;
use crate::services::realtime::SyncKind;
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

/// GET /api/user/volume
pub async fn get_all_volumes(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let volumes = volume::get_all_for_user(&state.db, user.id).await?;
    Ok(Json(serde_json::to_value(volumes).unwrap()))
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
    Path(mal_id): Path<i32>,
    Json(body): Json<BulkMarkRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    volume::bulk_mark_for_series(&state.db, user.id, mal_id, body.owned, body.read).await?;

    // Realtime fan-out: both the library counter and the volume rows
    // moved, so subscribed sessions need to re-pull both feeds.
    state.broker.publish(user.id, SyncKind::Library).await;
    state.broker.publish(user.id, SyncKind::Volumes).await;

    Ok(Json(json!({ "status": "ok" })))
}

/// GET /api/user/volume/:mal_id
pub async fn get_volumes_by_id(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    let volumes = volume::get_all_for_user_by_mal_id(&state.db, user.id, mal_id).await?;
    Ok(Json(serde_json::to_value(volumes).unwrap()))
}

/// POST /api/user/library/:mal_id/volumes/upcoming — manually create
/// an upcoming-volume row for this series.
pub async fn add_upcoming_volume(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
    Json(body): Json<UpcomingVolumeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vol_num = body
        .vol_num
        .ok_or_else(|| AppError::BadRequest("vol_num is required".into()))?;
    let inserted = volume::add_upcoming_manually(
        &state.db,
        user.id,
        mal_id,
        vol_num,
        body.release_date,
        body.release_isbn,
        body.release_url,
    )
    .await?;
    state.broker.publish(user.id, SyncKind::Volumes).await;
    Ok(Json(serde_json::to_value(inserted).unwrap()))
}

/// PATCH /api/user/volume/:id/upcoming — edit announce-side fields of
/// a manually-created upcoming row. Refused on API-origin rows.
pub async fn update_upcoming_volume(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<i32>,
    Json(body): Json<UpcomingVolumeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let updated = volume::update_upcoming_manually(
        &state.db,
        id,
        user.id,
        body.release_date,
        body.release_isbn,
        body.release_url,
    )
    .await?;
    state.broker.publish(user.id, SyncKind::Volumes).await;
    Ok(Json(serde_json::to_value(updated).unwrap()))
}

/// DELETE /api/user/volume/:id — remove a manually-created upcoming
/// row. Refused on API-origin rows (the sweep would resurrect them).
pub async fn delete_volume(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    volume::delete_manual_volume(&state.db, id, user.id).await?;
    state.broker.publish(user.id, SyncKind::Volumes).await;
    Ok(Json(json!({
        "success": true,
        "message": "Volume deleted successfully"
    })))
}

/// PATCH /api/user/volume
pub async fn update_volume(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(body): Json<UpdateVolumeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let id = body.id;
    let loan_change = body.loan;
    volume::update_by_id(
        &state.db,
        id,
        user.id,
        body.owned,
        body.price,
        body.store,
        body.collector,
        body.read,
        body.notes,
    )
    .await?;
    // Loan mutation rides on the same PATCH so a single round-trip
    // updates both ownership/read state and the loan triplet. Handler
    // applies it AFTER the main update so the row is in its final
    // ownership state before we mark it as lent (e.g. avoiding a
    // weird "lent but unowned" intermediate).
    if let Some(loan_patch) = loan_change {
        volume::set_loan(&state.db, id, user.id, loan_patch).await?;
    }
    state.broker.publish(user.id, SyncKind::Volumes).await;
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
