//! 対照 · Compare handler — diff the authed user's library with a
//! public profile identified by slug.

use axum::{extract::{Path, State}, Json};

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::models::compare::CompareResponse;
use crate::services::{compare, users};
use crate::state::AppState;

/// GET /api/user/compare/{slug}
///
/// Compares the authenticated user's library with the public profile
/// at `{slug}`. 404 when the slug doesn't resolve or isn't published.
/// Adult content from the other user is filtered unless they've
/// opted-in via `public_show_adult`; my own library is returned in
/// full regardless.
pub async fn compare_with(
    State(state): State<AppState>,
    AuthenticatedUser(me): AuthenticatedUser,
    Path(slug): Path<String>,
) -> Result<Json<CompareResponse>, AppError> {
    let normalised = slug.trim().to_lowercase();
    if normalised.is_empty() {
        return Err(AppError::NotFound("Profile not found".into()));
    }
    // Self-compare is pointless — reject with a clear 400 instead of
    // silently returning an all-shared payload.
    if me
        .public_slug
        .as_deref()
        .map(|s| s == normalised)
        .unwrap_or(false)
    {
        return Err(AppError::BadRequest(
            "Cannot compare with yourself.".into(),
        ));
    }
    let other = users::find_by_public_slug(&state.db, &normalised)
        .await?
        .ok_or_else(|| AppError::NotFound("Profile not found".into()))?;
    let payload = compare::compare_users(&state.db, &me, &other).await?;
    Ok(Json(payload))
}
