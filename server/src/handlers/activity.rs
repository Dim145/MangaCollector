use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::services::activity;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ActivityQuery {
    pub limit: Option<u64>,
    pub before: Option<i32>,
}

/// GET /api/user/activity?limit=30&before=<id>
/// Paginated activity feed, newest first.
pub async fn list_activity(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(q): Query<ActivityQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let limit = q.limit.unwrap_or(30).clamp(1, 100);
    let rows = activity::list_for_user(&state.db, user.id, limit, q.before).await?;
    Ok(Json(serde_json::to_value(rows).unwrap()))
}

/// GET /api/user/streak
/// 連 · Computes consecutive-day activity streak from the activity log.
/// See `services::activity::compute_streak` for the rule set.
pub async fn get_streak(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<activity::StreakInfo>, AppError> {
    let info = activity::compute_streak(&state.db, user.id).await?;
    Ok(Json(info))
}
