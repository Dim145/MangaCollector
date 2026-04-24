//! 対照 · Compare handler — diff the authed user's library with a
//! public profile identified by slug.

use axum::{extract::{Path, State}, Json};
use serde_json::json;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::models::compare::CompareResponse;
use crate::services::realtime::SyncKind;
use crate::services::{compare, library, users};
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

/// POST /api/user/compare/{slug}/add/{mal_id}
///
/// Copies a single series from the identified public profile into the
/// authenticated user's library. All the "smart" work lives in
/// `library::copy_series_from_other_user`: it handles the mal_id /
/// mangadex_id / custom branches, mints fresh negative ids when the
/// source was a custom entry, copies the poster blob from the other
/// user's S3 path when it was a manual upload, and creates the
/// per-volume rows so the MangaPage renders correctly straight away.
pub async fn copy_entry(
    State(state): State<AppState>,
    AuthenticatedUser(me): AuthenticatedUser,
    Path((slug, mal_id)): Path<(String, i32)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let normalised = slug.trim().to_lowercase();
    if normalised.is_empty() {
        return Err(AppError::NotFound("Profile not found".into()));
    }
    // Guard against the user somehow triggering a copy on their own
    // profile — there'd be nothing to add anyway.
    if me
        .public_slug
        .as_deref()
        .map(|s| s == normalised)
        .unwrap_or(false)
    {
        return Err(AppError::BadRequest(
            "Cannot copy from yourself.".into(),
        ));
    }
    let other = users::find_by_public_slug(&state.db, &normalised)
        .await?
        .ok_or_else(|| AppError::NotFound("Profile not found".into()))?;

    // Re-check that the target still has a public_slug at copy time.
    // `find_by_public_slug` already enforces this at lookup, but a
    // user could theoretically clear their slug between the compare
    // GET and the copy POST (unlikely but possible). Without this
    // belt-and-braces check, the copy would proceed with stale
    // knowledge of `other.id`, effectively granting access to a now-
    // private library. The slug lookup above returns None when
    // cleared, so normally we'd bail here anyway — keeping the
    // explicit guard makes the invariant obvious to future readers.
    if other.public_slug.as_deref().map(|s| s != normalised).unwrap_or(true) {
        return Err(AppError::NotFound("Profile not found".into()));
    }

    let entry = library::copy_series_from_other_user(
        &state.db,
        &state.storage,
        &state.http_client,
        state.cache.as_deref(),
        me.id,
        other.id,
        mal_id,
    )
    .await?;

    // Fan-out the realtime signals so the dashboard on any other
    // logged-in device of the user sees the new series appear.
    state.broker.publish(me.id, SyncKind::Library).await;
    state.broker.publish(me.id, SyncKind::Volumes).await;

    Ok(Json(json!({
        "success": true,
        "entry": entry,
    })))
}
