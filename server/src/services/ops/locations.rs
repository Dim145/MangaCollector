//! 棚 · Places-registry write paths.
//!
//! Every mutation here can move tomes — a rename rewrites the tomes
//! filed under the old name, a delete unfiles them — so they all owe
//! the volume feed an invalidation, never the library one: the series
//! rows themselves are untouched.
//!
//! See the module header in `super` for why these live here rather than
//! in `handlers::locations`.

use chrono::Utc;

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
    let (cleared, had_photo) = locations::remove(&state.db, user_id, id).await?;
    if had_photo {
        // Best effort. The row is gone either way; an orphan blob is
        // harmless, and failing the delete because a photo could not be
        // reached would leave the user unable to delete a place at all.
        let key = locations::photo_storage_path(user_id, id);
        if let Err(err) = state.storage.remove(&key).await {
            tracing::warn!(user_id, location_id = id, %err, "place photo cleanup failed");
        }
    }
    fan_out(state, user_id, &origin, None, &[SyncKind::Volumes]).await;
    Ok(cleared)
}

/// 写 · Put (or drop) the place's photo. The blob and the date move
/// together: a stamped row with no blob shows the reader a broken
/// image, and a blob with no stamp is never served at all.
///
/// `bytes: None` removes the photo. The caller has already checked the
/// size and the magic bytes — this is the write, not the door.
pub async fn set_photo(
    state: &AppState,
    user_id: i32,
    id: i64,
    bytes: Option<bytes::Bytes>,
    origin: Option<String>,
) -> Result<Option<String>, AppError> {
    // Read first: a photo for someone else's place must not reach
    // storage, and `set_photo` is what proves the place is theirs.
    let taken = match bytes {
        Some(data) => {
            let key = locations::photo_storage_path(user_id, id);
            // The row check has to come before the blob write, or a
            // stranger's upload would still land in our bucket.
            locations::photo_taken_at(&state.db, user_id, id).await?;
            state
                .storage
                .put(&key, data)
                .await
                .map_err(AppError::Storage)?;
            Some(Utc::now())
        }
        None => {
            let key = locations::photo_storage_path(user_id, id);
            locations::photo_taken_at(&state.db, user_id, id).await?;
            if let Err(err) = state.storage.remove(&key).await {
                tracing::warn!(user_id, location_id = id, %err, "place photo remove failed");
            }
            None
        }
    };
    let row = locations::set_photo(&state.db, user_id, id, taken).await?;
    fan_out(state, user_id, &origin, None, &[SyncKind::Volumes]).await;
    Ok(locations::photo_url(row.id, row.photo_updated_at))
}
