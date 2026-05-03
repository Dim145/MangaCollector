use axum::{
    Json,
    extract::{Path, State},
};
use serde_json::json;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::models::coffret::{Coffret, CreateCoffretRequest, UpdateCoffretRequest};
use crate::services::coffret;
use crate::services::realtime::SyncKind;
use crate::state::AppState;

async fn publish_coffret_sync(state: &AppState, user_id: i32) {
    state.broker.publish(user_id, SyncKind::Coffrets).await;
    // Coffret mutations also touch user_volumes (price share, owned
    // flag, collector flag cascade), so the client's volume queries
    // need to revalidate too.
    state.broker.publish(user_id, SyncKind::Volumes).await;
}

/// GET /api/user/library/:mal_id/coffrets
pub async fn list_for_manga(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<Vec<Coffret>>, AppError> {
    let rows = coffret::list_for_manga(&state.db, user.id, mal_id).await?;
    Ok(Json(rows))
}

/// POST /api/user/library/:mal_id/coffrets
pub async fn create(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
    Json(body): Json<CreateCoffretRequest>,
) -> Result<Json<Coffret>, AppError> {
    let row = coffret::create(&state.db, user.id, mal_id, &body).await?;
    publish_coffret_sync(&state, user.id).await;
    Ok(Json(row))
}

/// PATCH /api/user/coffrets/:id
pub async fn update(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<i32>,
    Json(body): Json<UpdateCoffretRequest>,
) -> Result<Json<Coffret>, AppError> {
    let row = coffret::update_by_id(&state.db, user.id, id, &body).await?;
    publish_coffret_sync(&state, user.id).await;
    Ok(Json(row))
}

/// DELETE /api/user/coffrets/:id
pub async fn delete(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    coffret::delete(&state.db, user.id, id).await?;
    publish_coffret_sync(&state, user.id).await;
    Ok(Json(json!({ "success": true })))
}
