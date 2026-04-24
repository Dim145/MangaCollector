//! Public endpoints — served without authentication.
//!
//! These handlers are deliberately kept lean: no session lookup, no
//! cookies touched, strictly read-only. The router registers them on a
//! /public prefix that lives outside the user_router() tree so they can
//! never be accidentally shadowed by an auth middleware.

use axum::{extract::{Path, State}, Json};

use crate::errors::AppError;
use crate::models::user::PublicProfileResponse;
use crate::services::users;
use crate::state::AppState;

/// GET /public/u/{slug}
///
/// Returns the read-only public profile (display name, stats, library
/// gallery) for whichever user owns that slug. 404 if no user has
/// claimed it. Adult genres are filtered server-side regardless of
/// anyone's preferences.
pub async fn get_public_profile(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<PublicProfileResponse>, AppError> {
    let normalised = slug.trim().to_lowercase();
    if normalised.is_empty() {
        return Err(AppError::NotFound("Profile not found".into()));
    }
    let user = users::find_by_public_slug(&state.db, &normalised)
        .await?
        .ok_or_else(|| AppError::NotFound("Profile not found".into()))?;
    let payload = users::build_public_profile(&state.db, &user).await?;
    Ok(Json(payload))
}
