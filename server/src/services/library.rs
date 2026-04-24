use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QuerySelect, Set, TransactionTrait,
};
use sea_orm::sea_query::{Expr, extension::postgres::PgExpr};

use crate::db::Db;
use crate::errors::AppError;
use crate::models::activity::event_types;
use crate::models::library::{
    self, ActiveModel, AddCustomRequest, AddFromMangadexRequest, AddLibraryRequest,
    Entity as LibraryEntity, LibraryEntry,
};
use crate::services::cache::CacheStore;
use crate::services::{activity, mangadex_api, settings, volume};
use crate::services::mal_api::get_manga_from_mal;

/// Genre names that trigger an adult-content poster upgrade via MangaDex.
/// Case-insensitive, kept in sync with `client/src/utils/library.js`.
fn has_adult_genre(genres: &[String]) -> bool {
    genres.iter().any(|g| {
        let lc = g.to_lowercase();
        lc == "hentai" || lc == "erotica" || lc == "adult"
    })
}

/// Ask MangaDex for a better (uncensored, often higher-res) cover when the
/// series has adult tags. Returns `Some(new_url)` only when an upgrade is
/// found; otherwise `None` so callers keep the MAL fallback.
///
/// Skipped when:
///   - No adult genre present
///   - `mal_id` is None or ≤ 0 (custom entries with negative ids don't exist
///     on MangaDex)
///   - `current_url` points to a user-uploaded file (path starting with `/`
///     rather than `http`) — we never override a custom upload
async fn maybe_upgrade_cover_for_adult(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    current_url: Option<&str>,
    genres: &[String],
    mal_id: Option<i32>,
    title_hint: &str,
) -> Option<String> {
    if !has_adult_genre(genres) {
        return None;
    }
    let id = mal_id?;
    if id <= 0 {
        // custom entry — no mal_id to cross-reference
        return None;
    }
    if let Some(url) = current_url {
        if !url.starts_with("http") {
            // user-uploaded custom path — don't touch
            return None;
        }
    }

    match mangadex_api::find_cover_url_by_mal_id(client, cache, id, title_hint).await {
        Ok(url) => url,
        Err(e) => {
            tracing::warn!(mal_id = id, error = %e, "cover-upgrade: MangaDex call failed");
            None
        }
    }
}

pub async fn get_user_library(db: &Db, user_id: i32) -> Result<Vec<LibraryEntry>, AppError> {
    let rows = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .all(db)
        .await
        .map_err(AppError::from)?;
    Ok(rows.into_iter().map(LibraryEntry::from).collect())
}

pub async fn get_user_manga(
    db: &Db,
    mal_id: i32,
    user_id: i32,
) -> Result<Vec<LibraryEntry>, AppError> {
    let rows = LibraryEntity::find()
        .filter(library::Column::MalId.eq(mal_id))
        .filter(library::Column::UserId.eq(user_id))
        .all(db)
        .await
        .map_err(AppError::from)?;
    Ok(rows.into_iter().map(LibraryEntry::from).collect())
}

pub async fn add_to_user_library(
    db: &Db,
    http_client: &reqwest::Client,
    cache: Option<&CacheStore>,
    user_id: i32,
    req: AddLibraryRequest,
) -> Result<LibraryEntry, AppError> {
    let now = Utc::now();
    let genres_vec = req.genres.clone().unwrap_or_default();
    let genres_str = genres_vec.join(",");
    let volumes_owned = req.volumes_owned.unwrap_or(0);
    let volumes = req.volumes;
    let mal_id = req.mal_id;

    // For adult-tagged series, try to upgrade the cover to the MangaDex
    // (uncensored, typically higher-res) version before we store the URL.
    // Silently falls back to MAL's cover on any failure.
    let image_url_final = match maybe_upgrade_cover_for_adult(
        http_client,
        cache,
        req.image_url_jpg.as_deref(),
        &genres_vec,
        mal_id,
        &req.name,
    )
    .await
    {
        Some(new_url) => Some(new_url),
        None => req.image_url_jpg.clone(),
    };

    let txn = db.begin().await.map_err(AppError::from)?;

    // Idempotent upsert: if the user already has this mal_id, return the
    // existing row rather than erroring with a unique constraint violation.
    // This matters when the offline outbox replays an add op whose first
    // attempt already succeeded before losing the network.
    if let Some(m) = mal_id {
        if let Some(existing) = LibraryEntity::find()
            .filter(library::Column::UserId.eq(user_id))
            .filter(library::Column::MalId.eq(m))
            .one(&txn)
            .await
            .map_err(AppError::from)?
        {
            txn.commit().await.map_err(AppError::from)?;
            return Ok(LibraryEntry::from(existing));
        }
    }

    let model = ActiveModel {
        created_on: Set(now),
        modified_on: Set(now),
        user_id: Set(user_id),
        mal_id: Set(mal_id),
        name: Set(req.name),
        volumes: Set(volumes),
        volumes_owned: Set(volumes_owned),
        image_url_jpg: Set(image_url_final),
        genres: Set(Some(genres_str)),
        mangadex_id: Set(req.mangadex_id.clone()),
        ..Default::default()
    };

    let row = model.insert(&txn).await.map_err(AppError::from)?;

    // Create one volume row per volume
    for vol_num in 1..=volumes {
        volume::add_volume_tx(&txn, user_id, row.mal_id.unwrap_or(0), vol_num).await?;
    }

    // Log activity within the same transaction so it's atomic with the add
    activity::record(
        &txn,
        user_id,
        event_types::SERIES_ADDED,
        row.mal_id,
        None,
        Some(row.name.clone()),
        None,
    )
    .await;

    txn.commit().await.map_err(AppError::from)?;

    // Milestone check AFTER commit (uses fresh DB view)
    activity::check_series_milestone(db, user_id).await;

    Ok(LibraryEntry::from(row))
}

/// Add a library entry sourced from MangaDex. No MAL id exists, so we mint a
/// new negative mal_id (same scheme as pure-custom entries) and tag the row
/// with `mangadex_id` so "refresh from MangaDex" can operate on it later.
pub async fn add_from_mangadex(
    db: &Db,
    http_client: &reqwest::Client,
    cache: Option<&CacheStore>,
    user_id: i32,
    req: AddFromMangadexRequest,
) -> Result<LibraryEntry, AppError> {
    // Idempotent: if the user already has this mangadex_id, return the row
    // rather than creating a duplicate with a new negative mal_id.
    if let Some(existing) = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MangadexId.eq(req.mangadex_id.clone()))
        .one(db)
        .await
        .map_err(AppError::from)?
    {
        return Ok(LibraryEntry::from(existing));
    }

    // Mint the next negative mal_id (same scheme as add_custom_entry).
    let min: Option<i32> = LibraryEntity::find()
        .select_only()
        .column_as(Expr::col(library::Column::MalId).min(), "min")
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.lt(0))
        .into_tuple::<Option<i32>>()
        .one(db)
        .await
        .map_err(AppError::from)?
        .flatten();

    let new_mal_id = min.unwrap_or(0) - 1;

    add_to_user_library(
        db,
        http_client,
        cache,
        user_id,
        AddLibraryRequest {
            mal_id: Some(new_mal_id),
            name: req.name,
            volumes: req.volumes,
            volumes_owned: req.volumes_owned,
            image_url_jpg: req.image_url_jpg,
            genres: req.genres,
            mangadex_id: Some(req.mangadex_id),
        },
    )
    .await
}

/// Re-sync a library entry's name, genres and cover from MangaDex. Only
/// applies to rows that carry a `mangadex_id` (either pure-MangaDex entries
/// or MAL entries that were cross-linked at add time).
pub async fn refresh_from_mangadex(
    db: &Db,
    http_client: &reqwest::Client,
    cache: Option<&CacheStore>,
    user_id: i32,
    mal_id: i32,
) -> Result<(Vec<String>, String, Option<String>), AppError> {
    let row = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound("Library entry not found".into()))?;

    let mangadex_id = row
        .mangadex_id
        .clone()
        .ok_or_else(|| AppError::BadRequest("No MangaDex link on this entry".into()))?;

    let md_data = crate::services::mangadex_api::get_by_id(http_client, cache, &mangadex_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .ok_or_else(|| AppError::NotFound("MangaDex info not found".into()))?;

    let now = Utc::now();
    let genres_str = md_data.genres.join(",");

    // Preserve user-uploaded custom posters (paths not starting with `http`).
    let image_update = match row.image_url_jpg.as_deref() {
        Some(u) if !u.starts_with("http") => row.image_url_jpg.clone(),
        _ => md_data.image_url.clone(),
    };

    let mut active: ActiveModel = row.into();
    active.genres = Set(Some(genres_str));
    active.name = Set(md_data.name.clone());
    active.image_url_jpg = Set(image_update.clone());
    active.modified_on = Set(now);
    active.update(db).await.map_err(AppError::from)?;

    Ok((md_data.genres, md_data.name, image_update))
}

/// Copy a user-uploaded poster blob from `src` to `dst` in the storage
/// backend, with a read-back verification step to catch silent failures.
///
/// Failure modes handled:
///   1. Source blob missing → return false, skip
///   2. Source blob empty (0 bytes) → return false, skip (don't
///      propagate a useless blob)
///   3. `put` returns Err → return false, skip
///   4. `put` returns Ok but verify read fails or returns empty bytes
///      → roll back the (potentially-broken) dst, return false
///
/// Why case 4 matters: the original bug report was a cover that went
/// missing right after a compare-import. In theory `put` returning Ok
/// should mean the object is durable on the next `get`. In practice,
/// MinIO upgrades mid-copy, bucket policy strippers, or a transient
/// endpoint issue can leave the caller with a success ACK and no
/// actual object. Without a verify step we'd record the custom-poster
/// URL in the library row and only discover the breakage on first
/// page load.
///
/// On any failure, we also `remove(dst)` so we don't leave a
/// half-written orphan. Caller should fall back to `None` in the
/// library row when this returns false — the UI will render the 巻
/// placeholder instead of a broken link.
async fn copy_poster_blob(
    storage: &dyn crate::storage::StorageBackend,
    src: &str,
    dst: &str,
) -> bool {
    let bytes = match storage.get(src).await {
        Ok(b) if b.is_empty() => {
            tracing::warn!(
                src = %src,
                "copy_poster: source blob is empty, skipping cover copy"
            );
            return false;
        }
        Ok(b) => b,
        Err(err) => {
            tracing::warn!(
                %err,
                src = %src,
                "copy_poster: source blob unreadable, skipping cover copy"
            );
            return false;
        }
    };
    let bytes_len = bytes.len();
    if let Err(err) = storage.put(dst, bytes).await {
        tracing::warn!(%err, dst = %dst, "copy_poster: put failed");
        return false;
    }
    // Verify round-trip. Also checks the size matches, so a partial
    // write (rare but possible under some S3 implementations) gets
    // caught here rather than becoming a silent data corruption.
    match storage.get(dst).await {
        Ok(v) if v.len() == bytes_len => {
            tracing::debug!(
                bytes = bytes_len,
                src = %src,
                dst = %dst,
                "copy_poster: copied + verified"
            );
            true
        }
        Ok(v) => {
            tracing::warn!(
                expected = bytes_len,
                actual = v.len(),
                dst = %dst,
                "copy_poster: verify read size mismatch, rolling back"
            );
            let _ = storage.remove(dst).await;
            false
        }
        Err(err) => {
            tracing::warn!(
                %err,
                dst = %dst,
                "copy_poster: verify read failed, rolling back"
            );
            let _ = storage.remove(dst).await;
            false
        }
    }
}

/// Copy a single series from another user's library into mine. Built
/// on top of `add_to_user_library` so we reuse the volume-row creation
/// and idempotent upsert logic. The wrinkle is the cover: when the
/// source entry has a custom upload (path-like URL, not http), we
/// copy the blob from their S3 path into mine under the new mal_id.
///
/// Behaviour by source entry type:
///   • MAL series (mal_id > 0)    → keep mal_id, keep image URL (CDN)
///   • MangaDex only              → mint new negative mal_id locally,
///                                  keep mangadex_id + image URL (CDN)
///   • Custom w/ external image   → mint new negative mal_id, keep URL
///   • Custom w/ manual upload    → mint new negative mal_id, copy
///                                  blob, stored URL becomes the
///                                  `/api/user/storage/poster/{new}` form
pub async fn copy_series_from_other_user(
    db: &Db,
    storage: &std::sync::Arc<dyn crate::storage::StorageBackend>,
    http_client: &reqwest::Client,
    cache: Option<&CacheStore>,
    me_user_id: i32,
    other_user_id: i32,
    source_mal_id: i32,
) -> Result<LibraryEntry, AppError> {
    // Fetch source row from the other user's library.
    let source = LibraryEntity::find()
        .filter(library::Column::UserId.eq(other_user_id))
        .filter(library::Column::MalId.eq(source_mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound("Source series not found".into()))?;
    let source_entry = LibraryEntry::from(source.clone());

    // Figure out the mal_id I'll use locally. MAL series keep their
    // positive id; everything else mints a fresh negative id so the
    // custom-entry / uniqueness invariants hold.
    let is_mal = source_mal_id > 0;
    let target_mal_id = if is_mal {
        source_mal_id
    } else {
        let min_existing: Option<i32> = LibraryEntity::find()
            .select_only()
            .column_as(Expr::col(library::Column::MalId).min(), "min")
            .filter(library::Column::UserId.eq(me_user_id))
            .filter(library::Column::MalId.lt(0))
            .into_tuple::<Option<i32>>()
            .one(db)
            .await
            .map_err(AppError::from)?
            .flatten();
        min_existing.unwrap_or(0) - 1
    };

    // Decide the image URL I'll store. External URLs (MAL CDN /
    // MangaDex CDN) work for everyone, so we reuse them. A path-ish
    // URL means the source was a user upload — copy the blob.
    //
    // This is always a *copy*, never a move: the source user's blob
    // stays untouched, and we write a fresh object under a key keyed by
    // *my* user_id + target_mal_id. Two distinct S3 objects.
    let is_custom_upload = source_entry
        .image_url_jpg
        .as_deref()
        .map(|u| !u.starts_with("http"))
        .unwrap_or(false);
    let final_image_url = if is_custom_upload {
        let src_path = format!(
            "uploads/images/{}/{}.jpg",
            other_user_id, source_mal_id
        );
        let dst_path = format!(
            "uploads/images/{}/{}.jpg",
            me_user_id, target_mal_id
        );
        if copy_poster_blob(storage.as_ref(), &src_path, &dst_path).await {
            Some(format!("/api/user/storage/poster/{}", target_mal_id))
        } else {
            // Copy failed (missing/empty source, put error, verify
            // mismatch) — fall back to no cover. Better a 巻 placeholder
            // than a library row pointing at a blob that doesn't exist.
            None
        }
    } else {
        source_entry.image_url_jpg.clone()
    };

    // Delegate to add_to_user_library for the library row + per-volume
    // creation + milestone hooks. `volumes_owned=0` honours the spec:
    // user gets the series listed but marked as "unowned" so they can
    // check off what they actually have afterwards.
    add_to_user_library(
        db,
        http_client,
        cache,
        me_user_id,
        AddLibraryRequest {
            mal_id: Some(target_mal_id),
            name: source_entry.name,
            volumes: source_entry.volumes,
            volumes_owned: Some(0),
            image_url_jpg: final_image_url,
            genres: if source_entry.genres.is_empty() {
                None
            } else {
                Some(source_entry.genres)
            },
            mangadex_id: source_entry.mangadex_id,
        },
    )
    .await
}

pub async fn add_custom_entry(
    db: &Db,
    http_client: &reqwest::Client,
    cache: Option<&CacheStore>,
    user_id: i32,
    req: AddCustomRequest,
) -> Result<LibraryEntry, AppError> {
    // Assign the next negative mal_id (custom entries use mal_id < 0)
    let min: Option<i32> = LibraryEntity::find()
        .select_only()
        .column_as(Expr::col(library::Column::MalId).min(), "min")
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.lt(0))
        .into_tuple::<Option<i32>>()
        .one(db)
        .await
        .map_err(AppError::from)?
        .flatten();

    let new_mal_id = min.unwrap_or(0) - 1;

    add_to_user_library(
        db,
        http_client,
        cache,
        user_id,
        AddLibraryRequest {
            mal_id: Some(new_mal_id),
            name: req.name,
            volumes: req.volumes,
            volumes_owned: req.volumes_owned,
            image_url_jpg: None,
            genres: req.genres,
            mangadex_id: None,
        },
    )
    .await
}

pub async fn delete_manga(db: &Db, mal_id: i32, user_id: i32) -> Result<(), AppError> {
    // Capture the title before delete so the activity log can reference it
    let row = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?;
    let name = row.map(|r| r.name);

    let txn = db.begin().await.map_err(AppError::from)?;
    volume::delete_all_for_user_by_mal_id_tx(&txn, user_id, mal_id).await?;
    LibraryEntity::delete_many()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal_id))
        .exec(&txn)
        .await
        .map_err(AppError::from)?;

    activity::record(
        &txn,
        user_id,
        event_types::SERIES_REMOVED,
        Some(mal_id),
        None,
        name,
        None,
    )
    .await;

    txn.commit().await.map_err(AppError::from)?;
    Ok(())
}

pub async fn get_total_volumes(
    db: &Db,
    mal_id: i32,
    user_id: i32,
) -> Result<Option<i32>, AppError> {
    let row = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?;
    Ok(row.map(|r| r.volumes))
}

pub async fn update_manga_volumes(
    db: &Db,
    mal_id: i32,
    user_id: i32,
    new_volumes: i32,
) -> Result<(), AppError> {
    let old_total = get_total_volumes(db, mal_id, user_id).await?.unwrap_or(0);

    if old_total == new_volumes {
        return Ok(());
    }

    if old_total > new_volumes {
        // Remove volumes that are now out of range
        for vol_num in (new_volumes + 1)..=old_total {
            volume::remove_volume_by_num(db, user_id, mal_id, vol_num).await?;
        }
    } else {
        // Add missing volumes
        for vol_num in (old_total + 1)..=new_volumes {
            volume::add_volume(db, user_id, mal_id, vol_num).await?;
        }
    }

    let now = Utc::now();
    // Partial update — use ActiveModel with only changed fields
    let row = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?;

    if let Some(existing) = row {
        let mut active: ActiveModel = existing.into();
        active.volumes = Set(new_volumes);
        active.modified_on = Set(now);
        active.update(db).await.map_err(AppError::from)?;
    }

    Ok(())
}

pub async fn update_volumes_owned(
    db: &Db,
    user_id: i32,
    mal_id: i32,
    volumes_owned: i32,
) -> Result<(), AppError> {
    let now = Utc::now();
    let row = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?;

    if let Some(existing) = row {
        let previous_owned = existing.volumes_owned;
        let total_volumes = existing.volumes;
        let name = existing.name.clone();

        let mut active: ActiveModel = existing.into();
        active.volumes_owned = Set(volumes_owned);
        active.modified_on = Set(now);
        active.update(db).await.map_err(AppError::from)?;

        // Completion milestone — emit once when the series flips to full
        if total_volumes > 0
            && previous_owned < total_volumes
            && volumes_owned >= total_volumes
        {
            activity::record(
                db,
                user_id,
                event_types::SERIES_COMPLETED,
                Some(mal_id),
                None,
                Some(name),
                Some(total_volumes),
            )
            .await;
        }

        // Cross-library volume milestones (50, 100, 250, …)
        activity::check_volume_milestone(db, user_id).await;
    }

    Ok(())
}

pub async fn change_poster(
    db: &Db,
    user_id: i32,
    mal_id: i32,
    new_poster_path: Option<String>,
) -> Result<(), AppError> {
    let now = Utc::now();
    let row = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?;

    if let Some(existing) = row {
        let mut active: ActiveModel = existing.into();
        active.image_url_jpg = Set(new_poster_path);
        active.modified_on = Set(now);
        active.update(db).await.map_err(AppError::from)?;
    }

    Ok(())
}

pub async fn search(
    db: &Db,
    user_id: i32,
    query: &str,
) -> Result<Vec<LibraryEntry>, AppError> {
    let pattern = format!("%{}%", query.to_lowercase());
    let rows = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(Expr::col(library::Column::Name).ilike(pattern))
        .all(db)
        .await
        .map_err(AppError::from)?;
    Ok(rows.into_iter().map(LibraryEntry::from).collect())
}

pub async fn update_infos_from_mal(
    db: &Db,
    http_client: &reqwest::Client,
    cache: Option<&CacheStore>,
    user_id: i32,
    mal_id: i32,
) -> Result<(Vec<String>, String), AppError> {
    let mal_data = get_manga_from_mal(http_client, cache, mal_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .ok_or_else(|| AppError::NotFound("MAL info not found".into()))?;

    // Collect genres from genres + demographics + explicit_genres (type == "manga")
    let genres: Vec<String> = mal_data
        .genres
        .iter()
        .flatten()
        .chain(mal_data.demographics.iter().flatten())
        .chain(mal_data.explicit_genres.iter().flatten())
        .filter(|g| g.genre_type == "manga")
        .map(|g| g.name.clone())
        .collect();

    // Determine title based on user's titleType setting
    let user_settings = settings::get_user_settings(db, user_id).await?;
    let title_type = user_settings.title_type.as_deref().unwrap_or("Default");

    let resolved_name = mal_data
        .titles
        .iter()
        .flatten()
        .find(|t| t.title_type == title_type)
        .map(|t| t.title.clone())
        .or_else(|| mal_data.title.clone())
        .unwrap_or_default();

    // Fetch the library rows for this user+manga and update them
    let rows = LibraryEntity::find()
        .filter(library::Column::MalId.eq(mal_id))
        .filter(library::Column::UserId.eq(user_id))
        .all(db)
        .await
        .map_err(AppError::from)?;

    for row in rows {
        // Update volumes if MAL has a different count
        if let Some(mal_volumes) = mal_data.volumes {
            if row.volumes != mal_volumes {
                update_manga_volumes(db, mal_id, user_id, mal_volumes).await?;
            }
        }

        let now = Utc::now();
        // Only overwrite image if no custom poster set
        let mut image_update = if row.image_url_jpg.is_none() {
            mal_data
                .images
                .as_ref()
                .and_then(|i| i.jpg.as_ref())
                .and_then(|j| j.image_url.clone())
        } else {
            row.image_url_jpg.clone()
        };

        // Adult series → prefer the uncensored MangaDex cover. Honours any
        // existing user-uploaded poster (skipped inside the helper).
        if let Some(new_url) = maybe_upgrade_cover_for_adult(
            http_client,
            cache,
            image_update.as_deref(),
            &genres,
            Some(mal_id),
            &resolved_name,
        )
        .await
        {
            image_update = Some(new_url);
        }

        let mut active: ActiveModel = row.into();
        active.genres = Set(Some(genres.join(",")));
        active.name = Set(resolved_name.clone());
        active.image_url_jpg = Set(image_update);
        active.modified_on = Set(now);
        active.update(db).await.map_err(AppError::from)?;
    }

    Ok((genres, resolved_name))
}
