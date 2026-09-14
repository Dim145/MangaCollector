//! 棚 · `/api/user/locations` — the places registry.
//!
//! Writes go through `services::ops::locations`, which owns the realtime
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
use crate::models::location::Model as Location;
use crate::services::locations::{self, LocationPatch, LocationsResponse};
use crate::services::ops;
use crate::state::AppState;

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
