use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QuerySelect, Set, TransactionTrait,
};
use sea_orm::sea_query::{Expr, extension::postgres::PgExpr};

use crate::db::Db;
use crate::errors::AppError;
use crate::models::activity::event_types;
use crate::models::library::{self, ActiveModel, AddCustomRequest, AddLibraryRequest, Entity as LibraryEntity, LibraryEntry};
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
