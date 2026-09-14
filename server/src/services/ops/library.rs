//! 蔵 · Library write paths.
//!
//! One function per mutation the SPA can perform on a series, each
//! carrying the validation and the realtime fan-out that mutation needs.
//! See the module header in `super` for why they live here rather than
//! in `handlers::library`.

use crate::errors::AppError;
use crate::models::library::{
    AddCustomRequest, AddFromMangadexRequest, AddLibraryRequest, LibraryEntry, UpdateLibraryRequest,
};
use crate::services::realtime::SyncKind;
use crate::services::{cover_pool, library, releases, settings as settings_svc};
use crate::state::AppState;

use super::fan_out;

/// Re-read the series' metadata from MyAnimeList. Returns the genres and
/// the name it settled on.
pub async fn update_from_mal(
    state: &AppState,
    user_id: i32,
    mal_id: i32,
    origin: Option<String>,
) -> Result<(Vec<String>, String), AppError> {
    let out = library::update_infos_from_mal(
        &state.db,
        &state.http_client,
        state.cache.as_deref(),
        user_id,
        mal_id,
    )
    .await?;
    fan_out(state, user_id, &origin, Some(mal_id), &[SyncKind::Library]).await;
    Ok(out)
}

/// Add a MyAnimeList series to the caller's library.
///
/// The id gate lives here, not at the HTTP edge: zero and negatives are
/// the custom-entry scheme, and a row minted through this path with one
/// of those ids is a row no MAL refresh can ever reconcile.
pub async fn add_to_library(
    state: &AppState,
    user_id: i32,
    body: AddLibraryRequest,
    origin: Option<String>,
) -> Result<LibraryEntry, AppError> {
    if body.mal_id.unwrap_or(0) <= 0 {
        return Err(AppError::BadRequest("Invalid MAL ID".into()));
    }
    let entry = library::add_to_user_library(
        &state.db,
        &state.http_client,
        state.cache.as_deref(),
        &state.activity,
        user_id,
        body,
    )
    .await?;
    fan_out(
        state,
        user_id,
        &origin,
        None,
        &[SyncKind::Library, SyncKind::Volumes],
    )
    .await;
    Ok(entry)
}

/// Add an entry sourced from the MangaDex search flow. Mints a negative
/// mal_id internally (same scheme as a custom entry) but keeps the
/// `mangadex_id` so the row stays refreshable.
pub async fn add_from_mangadex(
    state: &AppState,
    user_id: i32,
    body: AddFromMangadexRequest,
    origin: Option<String>,
) -> Result<LibraryEntry, AppError> {
    let trimmed_id = body.mangadex_id.trim();
    if trimmed_id.is_empty() {
        return Err(AppError::BadRequest("Invalid MangaDex id".into()));
    }
    // 印 · MangaDex ids are UUIDs in the canonical 8-4-4-4-12 hex form.
    // Without this gate, garbage strings (an injected path traversal, a
    // randomly-typed search query) land in the DB and are later fed to
    // `refresh_from_mangadex` → arbitrary outbound HTTP path.
    if !crate::util::uuid::is_canonical_uuid(trimmed_id) {
        return Err(AppError::BadRequest("MangaDex id must be a UUID".into()));
    }
    let entry = library::add_from_mangadex(
        &state.db,
        &state.http_client,
        state.cache.as_deref(),
        &state.activity,
        user_id,
        body,
    )
    .await?;
    fan_out(
        state,
        user_id,
        &origin,
        None,
        &[SyncKind::Library, SyncKind::Volumes],
    )
    .await;
    Ok(entry)
}

/// Re-read a series' metadata from MangaDex. Returns genres, name and
/// poster URL as they ended up.
pub async fn refresh_from_mangadex(
    state: &AppState,
    user_id: i32,
    mal_id: i32,
    origin: Option<String>,
) -> Result<(Vec<String>, String, Option<String>), AppError> {
    let out = library::refresh_from_mangadex(
        &state.db,
        &state.http_client,
        state.cache.as_deref(),
        user_id,
        mal_id,
    )
    .await?;
    fan_out(state, user_id, &origin, Some(mal_id), &[SyncKind::Library]).await;
    Ok(out)
}

/// Point the series' cover at an arbitrary URL.
///
/// The host allow-list is part of the operation, not of the HTTP layer:
/// without it any caller could park a tracking pixel or an unrelated
/// host in a field every device then loads.
pub async fn set_poster(
    state: &AppState,
    user_id: i32,
    mal_id: i32,
    url: String,
    origin: Option<String>,
) -> Result<(), AppError> {
    if !cover_pool::is_whitelisted_poster_url(&url) {
        return Err(AppError::BadRequest(
            "URL not allowed — must be an official MAL or MangaDex cover".into(),
        ));
    }
    library::change_poster(&state.db, user_id, mal_id, Some(url)).await?;
    fan_out(state, user_id, &origin, Some(mal_id), &[SyncKind::Library]).await;
    Ok(())
}

/// Create a series that exists in no catalogue, under a freshly-minted
/// negative mal_id.
pub async fn add_custom_entry(
    state: &AppState,
    user_id: i32,
    body: AddCustomRequest,
    origin: Option<String>,
) -> Result<LibraryEntry, AppError> {
    let entry = library::add_custom_entry(
        &state.db,
        &state.http_client,
        state.cache.as_deref(),
        &state.activity,
        user_id,
        body,
    )
    .await?;
    fan_out(
        state,
        user_id,
        &origin,
        None,
        &[SyncKind::Library, SyncKind::Volumes],
    )
    .await;
    Ok(entry)
}

/// Partial update of a library row — any subset of volumes, publisher,
/// edition, genres, review, author and the reading-progression fields.
///
/// 静 · A patch that carries nothing actionable publishes nothing. An
/// empty body used to fire a `Library` event and make every connected
/// device refetch the collection for no reason.
pub async fn update_manga(
    state: &AppState,
    user_id: i32,
    mal_id: i32,
    body: UpdateLibraryRequest,
    origin: Option<String>,
) -> Result<(), AppError> {
    let touches_volumes = body.volumes.is_some();
    let is_noop = body.volumes.is_none()
        && body.publisher.is_none()
        && body.edition.is_none()
        && body.genres.is_none()
        && body.review.is_none()
        && body.review_public.is_none()
        && body.author.is_none()
        && body.reading_status.is_none()
        && body.started_reading_at.is_none()
        && body.finished_reading_at.is_none()
        && body.times_read.is_none();

    library::apply_library_patch(&state.db, mal_id, user_id, body).await?;

    if !is_noop {
        // The volumes path mutates `user_volumes` alongside the count,
        // so it owes the volume feed an invalidation too.
        let kinds: &[SyncKind] = if touches_volumes {
            &[SyncKind::Library, SyncKind::Volumes]
        } else {
            &[SyncKind::Library]
        };
        fan_out(state, user_id, &origin, Some(mal_id), kinds).await;
    }
    Ok(())
}

/// 再読 · Start the series over: one more read-through on the tally,
/// every tome back to unread, status `reading` from today.
pub async fn start_reread(
    state: &AppState,
    user_id: i32,
    mal_id: i32,
    origin: Option<String>,
) -> Result<(), AppError> {
    library::start_reread(&state.db, user_id, mal_id).await?;
    fan_out(
        state,
        user_id,
        &origin,
        Some(mal_id),
        &[SyncKind::Library, SyncKind::Volumes],
    )
    .await;
    Ok(())
}

/// Set how many tomes of the series the caller owns.
pub async fn update_manga_owned(
    state: &AppState,
    user_id: i32,
    mal_id: i32,
    owned: i32,
    origin: Option<String>,
) -> Result<(), AppError> {
    library::update_volumes_owned(&state.db, user_id, mal_id, owned).await?;
    fan_out(
        state,
        user_id,
        &origin,
        Some(mal_id),
        &[SyncKind::Library, SyncKind::Volumes],
    )
    .await;
    Ok(())
}

/// Remove the series and everything hanging off it.
pub async fn delete_manga(
    state: &AppState,
    user_id: i32,
    mal_id: i32,
    origin: Option<String>,
) -> Result<(), AppError> {
    library::delete_manga(&state.db, &state.activity, mal_id, user_id).await?;
    // Coffrets are keyed on the series too, and go with it.
    fan_out(
        state,
        user_id,
        &origin,
        Some(mal_id),
        &[SyncKind::Library, SyncKind::Volumes, SyncKind::Coffrets],
    )
    .await;
    Ok(())
}

/// What a single-series upcoming refresh found and changed.
pub struct UpcomingRefresh {
    pub report: releases::ReconcileReport,
    /// How many announcements the cascade returned, before reconciling
    /// against what the user already tracks.
    pub discovered_count: usize,
}

/// 来 · On-demand discovery and reconcile of upcoming volumes for one
/// series.
pub async fn refresh_upcoming(
    state: &AppState,
    user_id: i32,
    mal_id: i32,
    origin: Option<String>,
) -> Result<UpcomingRefresh, AppError> {
    // Resolve the series name from the caller's own library row. The
    // API cascade keys on free-text title — without the row we would be
    // guessing, and a guess taken from caller-supplied input would let
    // anyone probe the upstream API at our cost.
    let entries = library::get_user_manga(&state.db, mal_id, user_id).await?;
    let entry = entries
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("Library entry not found".into()))?;

    // 探 · `start_vol` is the user's highest known volume + 1 (skipping
    // what they already track saves upstream quota); the locale comes
    // from their settings so a French user gets the Glénat / Pika
    // edition rather than the VIZ one. Defaults to "en" when unset —
    // Google Books' broadest catalogue.
    let highest = releases::highest_known_vol_num(&state.db, user_id, mal_id).await?;
    let start_vol = highest.saturating_add(1);
    let user_settings = settings_svc::get_user_settings(&state.db, user_id).await?;
    let lang = user_settings
        .language
        .clone()
        .unwrap_or_else(|| "en".to_string());

    let discovered = releases::discover_upcoming_with_locale(
        &state.http_client,
        state.cache.as_deref(),
        state.config.google_books_api_key.as_deref(),
        &entry.name,
        start_vol,
        &lang,
        mal_id,
        state.config.external_proxy_url.as_deref(),
        std::time::Duration::from_secs(state.config.external_proxy_timeout_secs),
    )
    .await?;

    let report = releases::reconcile_user(&state.db, user_id, mal_id, &discovered).await?;

    // 同期 · Only when the reconcile actually mutated something — a
    // sweep with nothing new to announce should not cost every
    // connected device a refetch. The series row itself is untouched,
    // so `Library` is not owed an event, only the child volume rows.
    if !report.added.is_empty() || !report.updated.is_empty() {
        fan_out(state, user_id, &origin, Some(mal_id), &[SyncKind::Volumes]).await;
    }

    Ok(UpcomingRefresh {
        report,
        discovered_count: discovered.len(),
    })
}

/// 読 · Set where the caller is in a series: status, and the dates that
/// go with it.
///
/// A thin front for [`update_manga`] rather than its own write path —
/// `services::library` validates the status against
/// `models::library::READING_STATUSES` and refuses an unknown one with a
/// message naming the whole set, which is exactly what an agent needs to
/// correct itself.
pub async fn set_reading_state(
    state: &AppState,
    user_id: i32,
    mal_id: i32,
    status: Option<String>,
    started_at: Option<chrono::NaiveDate>,
    finished_at: Option<chrono::NaiveDate>,
    origin: Option<String>,
) -> Result<(), AppError> {
    let body = UpdateLibraryRequest {
        // `Some(None)` clears, `Some(Some(v))` sets, `None` leaves
        // alone — the three-state shape the wire type uses throughout.
        reading_status: status.map(|s| {
            let s = s.trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        }),
        started_reading_at: started_at.map(Some),
        finished_reading_at: finished_at.map(Some),
        ..Default::default()
    };
    update_manga(state, user_id, mal_id, body, origin).await
}
