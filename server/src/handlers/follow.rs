//! 友 Tomo · Follow + activity feed handlers.

use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;
use serde_json::json;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::models::follow::{FeedEntry, FollowedUser};
use crate::services::follow;
use crate::services::realtime::SyncKind;
use crate::state::AppState;

/// GET /api/user/follows — list users the caller follows.
pub async fn list_follows(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<Vec<FollowedUser>>, AppError> {
    let rows = follow::list_following(&state.db, user.id).await?;
    Ok(Json(rows))
}

/// POST /api/user/follows/{slug} — start following a user identified
/// by their public slug. Idempotent (re-follow is a no-op).
pub async fn follow_user(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(slug): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    follow::follow_by_slug(&state.db, user.id, &slug).await?;
    state.broker.publish(user.id, SyncKind::Friends).await;
    Ok(Json(json!({ "ok": true })))
}

/// DELETE /api/user/follows/{slug} — stop following.
pub async fn unfollow_user(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(slug): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    follow::unfollow_by_slug(&state.db, user.id, &slug).await?;
    state.broker.publish(user.id, SyncKind::Friends).await;
    Ok(Json(json!({ "ok": true })))
}

/// GET /api/user/follows/{slug}/check — am I following this slug?
/// Returns `{ following: bool }` so the public profile page can
/// render the right button state without parsing the full follow
/// list every render.
pub async fn check_following(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(slug): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let following = follow::is_following(&state.db, user.id, &slug).await?;
    Ok(Json(json!({ "following": following })))
}

#[derive(Debug, Deserialize)]
pub struct FeedQuery {
    #[serde(default)]
    pub limit: Option<u64>,
}

/// GET /api/user/follows/feed — aggregate activity feed across
/// every followed user. `?limit=N` opts into a custom page size
/// (clamped server-side).
pub async fn get_feed(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(q): Query<FeedQuery>,
) -> Result<Json<Vec<FeedEntry>>, AppError> {
    let limit = q.limit.unwrap_or(follow::FEED_LIMIT_DEFAULT);
    let entries = follow::feed(&state.db, user.id, limit).await?;
    Ok(Json(entries))
}
