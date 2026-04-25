//! Public endpoints — served without authentication.
//!
//! These handlers are deliberately kept lean: no session lookup, no
//! cookies touched, strictly read-only. The router registers them on a
//! /public prefix that lives outside the user_router() tree so they can
//! never be accidentally shadowed by an auth middleware.

use axum::{
    body::Body,
    extract::{Path, State},
    http::header,
    response::{IntoResponse, Response},
    Json,
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

use crate::errors::AppError;
use crate::models::library::{self, Entity as LibraryEntity, LibraryEntry};
use crate::models::user::PublicProfileResponse;
use crate::services::{library as library_svc, users};
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

/// GET /public/u/{slug}/poster/{mal_id}
///
/// Serve a user's custom-uploaded poster to anonymous / cross-user
/// visitors. Fills the gap where the private
/// `/api/user/storage/poster/{mal_id}` endpoint resolved the poster
/// against the *caller's* library, so user B visiting user A's public
/// profile would either 404 or see their OWN cover for the same mal_id.
///
/// Access rules, enforced in order:
///   1. Slug must resolve to a user who still has `public_slug` set
///      (`find_by_public_slug` already checks this — if the user
///      revokes their slug, every public poster URL 404s instantly).
///   2. `mal_id` must be in that user's library (can't enumerate
///      arbitrary ids hoping for a blob hit).
///   3. If the user has NOT opted-in to public adult content AND the
///      series has adult genres → 404 (exact mirror of the filter in
///      `build_public_profile` / `compare_users`).
///   4. The stored `image_url_jpg` must be a custom upload (not an
///      external CDN URL) — external URLs never had a blob on our
///      side.
///   5. The blob must exist in storage. Missing blob → 404; no
///      self-heal from this handler (we don't want anonymous traffic
///      to trigger DB writes on other users' rows).
///
/// `Cache-Control: public, max-age=86400` — covers change rarely and
/// the URL is stable (keyed by slug + mal_id), so shared caches can
/// serve identical bytes across all visitors.
pub async fn get_public_poster(
    State(state): State<AppState>,
    Path((slug, mal_id)): Path<(String, i32)>,
) -> Result<Response, AppError> {
    let normalised = slug.trim().to_lowercase();
    if normalised.is_empty() {
        return Err(AppError::NotFound("Profile not found".into()));
    }

    let user = users::find_by_public_slug(&state.db, &normalised)
        .await?
        .ok_or_else(|| AppError::NotFound("Profile not found".into()))?;

    // Library-row presence gate (rule 2). `LibraryEntry::from` parses
    // the comma-separated `genres` column into a `Vec<String>` which
    // lets us reuse the existing adult-filter helper.
    let row = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user.id))
        .filter(library::Column::MalId.eq(mal_id))
        .one(&state.db)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound("Poster not found".into()))?;
    let entry = LibraryEntry::from(row);

    // Adult filter (rule 3). Uses the same helper as the gallery so
    // the two can never drift — hiding a card in the gallery while
    // leaving its cover fetchable via direct URL would be a silent
    // enumeration leak.
    if !user.public_show_adult && users::entry_is_adult(&entry.genres) {
        return Err(AppError::NotFound("Poster not found".into()));
    }

    // Custom-upload gate (rule 4). `is_external_http_url` is the same
    // predicate used everywhere else to distinguish CDN URLs from
    // server-side paths.
    let raw_url = entry.image_url_jpg.unwrap_or_default();
    if library_svc::is_external_http_url(&raw_url) || raw_url.is_empty() {
        return Err(AppError::NotFound("Not a custom poster".into()));
    }

    // Fetch the blob. Path scheme is the same as the private endpoint:
    // `uploads/images/{user_id}/{mal_id}.jpg`. On missing blob we just
    // 404 — clients can fall back to the MAL CDN URL via the payload
    // rewrite, or render the 巻 placeholder.
    let path = format!("uploads/images/{}/{}.jpg", user.id, mal_id);
    let data = state.storage.get(&path).await.map_err(|err| {
        tracing::debug!(
            %err,
            user_id = user.id,
            mal_id,
            "public-poster: blob missing for {}",
            path
        );
        AppError::NotFound("Poster blob missing".into())
    })?;

    let response = (
        [
            (
                header::CONTENT_TYPE,
                "image/jpeg".parse::<http::HeaderValue>().unwrap(),
            ),
            (
                // `public` — this blob is identical for every visitor.
                // `max-age=86400` (1 day) balances "pick up a new cover
                // reasonably fast" with "don't hammer the backend for
                // shared caches". A 新 upload bumps the cache via a
                // URL-stable-but-mtime-shifted response; browsers will
                // re-fetch at most 24h later.
                header::CACHE_CONTROL,
                "public, max-age=86400".parse().unwrap(),
            ),
        ],
        Body::from(data),
    )
        .into_response();

    Ok(response)
}
