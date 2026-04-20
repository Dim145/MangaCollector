use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::json;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::models::coffret::{CreateCoffretRequest, UpdateCoffretRequest};
use crate::services::coffret;
use crate::state::AppState;

/// GET /api/user/library/:mal_id/coffrets
pub async fn list_for_manga(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = coffret::list_for_manga(&state.db, user.id, mal_id).await?;
    Ok(Json(serde_json::to_value(rows).unwrap()))
}

/// POST /api/user/library/:mal_id/coffrets
pub async fn create(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
    Json(body): Json<CreateCoffretRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row = coffret::create(&state.db, user.id, mal_id, &body).await?;
    Ok(Json(serde_json::to_value(row).unwrap()))
}

/// PATCH /api/user/coffrets/:id
pub async fn update(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<i32>,
    Json(body): Json<UpdateCoffretRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row = coffret::update_by_id(&state.db, user.id, id, &body).await?;
    Ok(Json(serde_json::to_value(row).unwrap()))
}

/// DELETE /api/user/coffrets/:id
pub async fn delete(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    coffret::delete(&state.db, user.id, id).await?;
    Ok(Json(json!({ "success": true })))
}
