//! Private endpoints that manage the user's own public-profile settings.
//!
//! Exposes `GET /api/user/public-slug` (returns the current slug or null)
//! and `PATCH /api/user/public-slug` (set / clear / change). Uniqueness
//! + validation live in the service.

use axum::{extract::State, Json};

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::models::user::{
    PublicSlugResponse, UpdatePublicAdultRequest, UpdatePublicSlugRequest,
    UpdateWishlistPublicRequest,
};
use serde_json::json;
use crate::services::users;
use crate::state::AppState;

/// GET /api/user/public-slug — returns the authenticated user's current
/// public profile state (slug + adult-content opt-in).
pub async fn get_public_slug(
    State(_state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<PublicSlugResponse>, AppError> {
    Ok(Json(PublicSlugResponse {
        slug: user.public_slug,
        show_adult: user.public_show_adult,
    }))
}

/// PATCH /api/user/public-slug — set / change / clear the slug. Body:
/// `{ "slug": "my-handle" }` to set, `{ "slug": null }` or
/// `{ "slug": "" }` to disable the public profile. Returns the full
/// state (slug + show_adult) so the client stays in sync.
pub async fn update_public_slug(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(body): Json<UpdatePublicSlugRequest>,
) -> Result<Json<PublicSlugResponse>, AppError> {
    let slug = users::set_public_slug(&state.db, user.id, body.slug.as_deref()).await?;
    // Re-fetch the user's current show_adult so the response reflects
    // both fields (the client may toggle either and expects both back).
    let fresh = users::get_by_id(&state.db, user.id)
        .await?
        .ok_or(AppError::Unauthorized)?;
    Ok(Json(PublicSlugResponse {
        slug,
        show_adult: fresh.public_show_adult,
    }))
}

/// PATCH /api/user/public-adult — toggle the "include adult content in
/// public profile" flag. Body: `{ "show_adult": true | false }`.
/// Returns the refreshed full state.
pub async fn update_public_adult(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(body): Json<UpdatePublicAdultRequest>,
) -> Result<Json<PublicSlugResponse>, AppError> {
    let show_adult =
        users::set_public_show_adult(&state.db, user.id, body.show_adult).await?;
    let fresh = users::get_by_id(&state.db, user.id)
        .await?
        .ok_or(AppError::Unauthorized)?;
    Ok(Json(PublicSlugResponse {
        slug: fresh.public_slug,
        show_adult,
    }))
}

/// PATCH /api/user/wishlist-public — 祝 birthday-mode toggle.
///
/// Body: `{ "days": <integer> }`. Days > 0 sets the horizon to
/// `now() + days` (clamped server-side); days <= 0 clears it. Returns
/// the resolved horizon (or `null` when cleared) so the client can
/// hydrate its countdown from the canonical value rather than its
/// own clock.
///
/// Auth required (the toggle changes what anonymous visitors see at
/// `/u/{slug}`, but only the owner may flip it).
pub async fn update_wishlist_public(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(body): Json<UpdateWishlistPublicRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let until = users::set_wishlist_public_until(&state.db, user.id, body.days).await?;
    Ok(Json(json!({ "wishlist_public_until": until })))
}
