//! 巻 · Volume write paths — ownership and read state, the physical
//! copy, loans, and the manually-announced upcoming rows.
//!
//! See the module header in `super` for why these live here rather than
//! in `handlers::volume`.

use crate::errors::AppError;
use crate::models::volume::{UpdateVolumeRequest, Volume};
use crate::services::realtime::SyncKind;
use crate::services::volume;
use crate::state::AppState;

use super::fan_out;

/// Cascade `owned` / `read` to every released volume of a series.
///
/// Passing neither is a no-op; `read: false` clears the read timestamp
/// and `read: true` stamps now.
pub async fn bulk_mark_volumes(
    state: &AppState,
    user_id: i32,
    mal_id: i32,
    owned: Option<bool>,
    read: Option<bool>,
    origin: Option<String>,
) -> Result<(), AppError> {
    volume::bulk_mark_for_series(&state.db, user_id, mal_id, owned, read).await?;
    // Both the library counter and the volume rows moved, so subscribed
    // sessions need to re-pull both feeds.
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

/// The announce-side fields of an upcoming row.
///
/// Grouped rather than passed loose because the create and the edit
/// path take exactly the same three, and because a caller assembling
/// them by position would have two `Option<String>` in a row to get
/// wrong.
pub struct UpcomingDetails {
    pub release_date: chrono::DateTime<chrono::Utc>,
    pub release_isbn: Option<String>,
    pub release_url: Option<String>,
}

/// Create an upcoming-volume row by hand, for a tome the discovery
/// cascade does not know about.
///
/// `vol_num` is optional on the wire and required here: a row without
/// one cannot be placed in the series, and refusing it at the edge of
/// the operation keeps every caller held to the same rule.
pub async fn add_upcoming_volume(
    state: &AppState,
    user_id: i32,
    mal_id: i32,
    vol_num: Option<i32>,
    details: UpcomingDetails,
    origin: Option<String>,
) -> Result<Volume, AppError> {
    let vol_num = vol_num.ok_or_else(|| AppError::BadRequest("vol_num is required".into()))?;
    let inserted = volume::add_upcoming_manually(
        &state.db,
        user_id,
        mal_id,
        vol_num,
        details.release_date,
        details.release_isbn,
        details.release_url,
    )
    .await?;
    fan_out(state, user_id, &origin, Some(mal_id), &[SyncKind::Volumes]).await;
    Ok(inserted)
}

/// Edit the announce-side fields of a manually-created upcoming row.
/// Refused on API-origin rows.
pub async fn update_upcoming_volume(
    state: &AppState,
    user_id: i32,
    id: i32,
    details: UpcomingDetails,
    origin: Option<String>,
) -> Result<Volume, AppError> {
    let updated = volume::update_upcoming_manually(
        &state.db,
        id,
        user_id,
        details.release_date,
        details.release_isbn,
        details.release_url,
    )
    .await?;
    fan_out(state, user_id, &origin, None, &[SyncKind::Volumes]).await;
    Ok(updated)
}

/// Remove a manually-created upcoming row. Refused on API-origin rows —
/// the nightly sweep would only resurrect them.
pub async fn delete_volume(
    state: &AppState,
    user_id: i32,
    id: i32,
    origin: Option<String>,
) -> Result<(), AppError> {
    volume::delete_manual_volume(&state.db, id, user_id).await?;
    fan_out(state, user_id, &origin, None, &[SyncKind::Volumes]).await;
    Ok(())
}

/// Patch one volume: ownership, read state, price, store, notes — plus
/// the loan and physical-copy triplets that ride on the same request so
/// a single round-trip covers the whole drawer.
pub async fn update_volume(
    state: &AppState,
    user_id: i32,
    mut body: UpdateVolumeRequest,
    origin: Option<String>,
) -> Result<(), AppError> {
    let id = body.id;
    // 物 · Physical-copy fields ride along and are applied after the
    // main update, like the loan.
    let physical = body.take_physical();
    let loan_change = body.loan;

    let outcome = volume::update_by_id(
        &state.db,
        &state.activity,
        id,
        user_id,
        body.owned,
        body.price,
        body.store,
        body.collector,
        body.read,
        body.notes,
    )
    .await?;

    // Applied AFTER the main update so the row is in its final ownership
    // state before it is marked as lent — otherwise a patch that both
    // un-owns and lends leaves a "lent but unowned" intermediate.
    if let Some(loan_patch) = loan_change {
        volume::set_loan(&state.db, id, user_id, loan_patch).await?;
    }
    volume::set_physical_details(&state.db, id, user_id, physical).await?;

    let series_id = outcome.series_id;
    fan_out(state, user_id, &origin, series_id, &[SyncKind::Volumes]).await;
    // 読 · The read flip moved the series' reading progression: other
    // sessions need the library row too, not just the volume rows.
    if outcome.library_changed {
        fan_out(state, user_id, &origin, series_id, &[SyncKind::Library]).await;
    }
    Ok(())
}
