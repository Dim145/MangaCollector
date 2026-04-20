use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::json;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::models::volume::UpdateVolumeRequest;
use crate::services::volume;
use crate::state::AppState;

/// GET /api/user/volume
pub async fn get_all_volumes(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let volumes = volume::get_all_for_user(&state.db, user.id).await?;
    Ok(Json(serde_json::to_value(volumes).unwrap()))
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

/// PATCH /api/user/volume
pub async fn update_volume(
    State(state): State<AppState>,
    AuthenticatedUser(_user): AuthenticatedUser,
    Json(body): Json<UpdateVolumeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    volume::update_by_id(
        &state.db,
        body.id,
        body.owned,
        body.price,
        body.store,
        body.collector,
    )
    .await?;
    Ok(Json(json!({
        "success": true,
        "message": "Volume updated successfully"
    })))
}
