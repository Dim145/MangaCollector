//! 棚 · Places-registry write paths.
//!
//! Every mutation here can move tomes — a rename rewrites the tomes
//! filed under the old name, a delete unfiles them — so they all owe
//! the volume feed an invalidation, never the library one: the series
//! rows themselves are untouched.
//!
//! See the module header in `super` for why these live here rather than
//! in `handlers::locations`.

use crate::errors::AppError;
use crate::models::location::Model as Location;
use crate::services::locations::{self, LocationPatch};
use crate::services::realtime::SyncKind;
use crate::state::AppState;

use super::fan_out;

/// Create a place, or return the existing one of that name.
pub async fn create(
    state: &AppState,
    user_id: i32,
    name: &str,
    note: Option<String>,
    origin: Option<String>,
) -> Result<Location, AppError> {
    let row = locations::create(&state.db, user_id, name, note).await?;
    fan_out(state, user_id, &origin, None, &[SyncKind::Volumes]).await;
    Ok(row)
}

/// Rename (which moves its tomes), annotate, or reorder a place.
pub async fn update(
    state: &AppState,
    user_id: i32,
    id: i64,
    patch: LocationPatch,
    origin: Option<String>,
) -> Result<Location, AppError> {
    let row = locations::update(&state.db, user_id, id, patch).await?;
    fan_out(state, user_id, &origin, None, &[SyncKind::Volumes]).await;
    Ok(row)
}

/// Delete a place. Its tomes stay and are unfiled; the count of those
/// comes back.
pub async fn remove(
    state: &AppState,
    user_id: i32,
    id: i64,
    origin: Option<String>,
) -> Result<u64, AppError> {
    let cleared = locations::remove(&state.db, user_id, id).await?;
    fan_out(state, user_id, &origin, None, &[SyncKind::Volumes]).await;
    Ok(cleared)
}
