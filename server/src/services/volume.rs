use chrono::Utc;
use rust_decimal::Decimal;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set,
};

use crate::db::Db;
use crate::errors::AppError;
use crate::models::activity::event_types;
use crate::models::library::{self as library_mod, Entity as LibraryEntity};
use crate::models::volume::{
    self, ActiveModel, Entity as VolumeEntity, Volume, NOTE_MAX_CHARS,
};
use crate::services::activity;

/// Trim, truncate to NOTE_MAX_CHARS, and collapse empty strings to
/// NULL. Truncation is silent — the client enforces the same cap
/// with a live counter, so a payload exceeding it is either a stale
/// outbox replay or a misbehaving caller.
fn normalise_note(input: String) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        None
    } else if trimmed.chars().count() > NOTE_MAX_CHARS {
        Some(trimmed.chars().take(NOTE_MAX_CHARS).collect())
    } else {
        Some(trimmed.to_string())
    }
}

pub async fn get_all_for_user(db: &Db, user_id: i32) -> Result<Vec<Volume>, AppError> {
    VolumeEntity::find()
        .filter(volume::Column::UserId.eq(user_id))
        .all(db)
        .await
        .map_err(AppError::from)
}

pub async fn get_all_for_user_by_mal_id(
    db: &Db,
    user_id: i32,
    mal_id: i32,
) -> Result<Vec<Volume>, AppError> {
    VolumeEntity::find()
        .filter(volume::Column::UserId.eq(user_id))
        .filter(volume::Column::MalId.eq(mal_id))
        .all(db)
        .await
        .map_err(AppError::from)
}

pub async fn update_by_id(
    db: &Db,
    id: i32,
    user_id: i32,
    owned: bool,
    price: Option<Decimal>,
    store: Option<String>,
    collector: bool,
    read: Option<bool>,
    // `None` leaves the note column untouched.
    notes: Option<String>,
) -> Result<(), AppError> {
    // Note: the update is idempotent on two axes — a row that no longer
    // exists (e.g. offline outbox replay after deletion) and a row that
    // exists under another user (IDOR attempt or stale client state).
    // Both paths return Ok without touching the DB. The caller doesn't
    // need to distinguish, and we never leak existence info to an
    // attacker who guessed a row id.
    let now = Utc::now();

    // Fetch the existing row scoped to the caller — the user_id filter
    // is the horizontal-authz gate. `find_by_id` alone is NOT enough:
    // every authenticated user can call this handler with any row id
    // they fancy, so the filter is mandatory. Also used below to decide
    // whether to emit an activity event.
    let existing = VolumeEntity::find()
        .filter(volume::Column::Id.eq(id))
        .filter(volume::Column::UserId.eq(user_id))
        .one(db)
        .await
        .map_err(AppError::from)?;

    // 来 · Upcoming-volume guardrail. A row whose `release_date` is
    // still in the future represents an announced-but-not-yet-shipped
    // tome. The product rule says it can't be owned, read, or marked
    // collector — it's not real yet. Rather than scatter conditions
    // through the column-expression chain below, we coerce the
    // incoming flags here so the rest of the function operates on
    // already-sanitised values. Only the `store` / `price` paths
    // remain sensitive to user input on upcoming rows (writing a
    // pre-order note ahead of time is fine, even useful).
    let is_upcoming = existing
        .as_ref()
        .and_then(|r| r.release_date)
        .map(|d| d > now)
        .unwrap_or(false);
    let (owned, collector, read) = if is_upcoming {
        // Force the three "I have this" axes to false/null. We
        // intentionally don't bail with an error: the SPA might
        // be replaying a stale outbox entry from before the
        // announcement landed, and 400-ing it would jam the sync
        // loop. Silently zeroing matches the same forgiving
        // policy as the row-not-found / cross-user paths above.
        (false, false, Some(false))
    } else {
        (owned, collector, read)
    };

    // Second, independent defence in depth: scope the UPDATE itself by
    // (id, user_id). Even if `existing` were wrong somehow (e.g. a bug
    // in a future refactor of the lookup above), the DB will refuse to
    // touch rows owned by anyone else.
    let mut query = VolumeEntity::update_many()
        .filter(volume::Column::Id.eq(id))
        .filter(volume::Column::UserId.eq(user_id))
        .col_expr(volume::Column::Owned, owned.into())
        .col_expr(
            volume::Column::Price,
            price.map_or_else(
                || sea_orm::sea_query::Expr::value(Option::<Decimal>::None),
                sea_orm::sea_query::Expr::value,
            ),
        )
        .col_expr(
            volume::Column::Store,
            store.map_or_else(
                || sea_orm::sea_query::Expr::value(Option::<String>::None),
                sea_orm::sea_query::Expr::value,
            ),
        )
        .col_expr(volume::Column::Collector, collector.into())
        .col_expr(volume::Column::ModifiedOn, now.into());

    // Conditional write so a stale outbox replay of an unrelated
    // partial PATCH (price-only, etc.) can't accidentally wipe a
    // note set by a later request that already landed.
    if let Some(raw_note) = notes {
        let normalised = normalise_note(raw_note);
        query = query.col_expr(
            volume::Column::Notes,
            normalised.map_or_else(
                || sea_orm::sea_query::Expr::value(Option::<String>::None),
                sea_orm::sea_query::Expr::value,
            ),
        );
    }

    // Reading status — three-way behaviour to preserve the first-read
    // timestamp across toggles:
    //  • None          → field untouched
    //  • Some(true)    → stamp to NOW iff currently NULL (keeps original
    //                    read date on repeated marks)
    //  • Some(false)   → clear to NULL
    if let Some(mark_read) = read {
        if mark_read {
            let already_read = existing
                .as_ref()
                .and_then(|r| r.read_at)
                .is_some();
            if !already_read {
                query = query.col_expr(volume::Column::ReadAt, now.into());
            }
        } else {
            query = query.col_expr(
                volume::Column::ReadAt,
                sea_orm::sea_query::Expr::value(
                    Option::<chrono::DateTime<chrono::Utc>>::None,
                ),
            );
        }
    }

    query.exec(db).await.map_err(AppError::from)?;

    // Log ownership transitions only — price/store edits alone don't produce
    // an activity entry.
    if let Some(prev) = existing {
        if prev.owned != owned {
            let mal_id = prev.mal_id.unwrap_or(0);
            // Series name is a nice-to-have for the activity feed —
            // failing to fetch it shouldn't block the ownership flip,
            // but we do want operator visibility when it happens,
            // otherwise the feed degrades to "unknown series" entries
            // and the cause is invisible.
            let series_name = match LibraryEntity::find()
                .filter(library_mod::Column::UserId.eq(prev.user_id))
                .filter(library_mod::Column::MalId.eq(mal_id))
                .one(db)
                .await
            {
                Ok(opt) => opt.map(|r| r.name),
                Err(err) => {
                    tracing::warn!(
                        %err,
                        user_id = prev.user_id,
                        mal_id,
                        "update_by_id: series-name lookup for activity log failed"
                    );
                    None
                }
            };

            activity::record(
                db,
                prev.user_id,
                if owned {
                    event_types::VOLUME_OWNED
                } else {
                    event_types::VOLUME_UNOWNED
                },
                Some(mal_id),
                Some(prev.vol_num),
                series_name,
                None,
            )
            .await;
        }
    }

    Ok(())
}

pub async fn add_volume(db: &Db, user_id: i32, mal_id: i32, vol_num: i32) -> Result<Volume, AppError> {
    let now = Utc::now();
    let model = ActiveModel {
        created_on: Set(now),
        modified_on: Set(now),
        user_id: Set(user_id),
        mal_id: Set(Some(mal_id)),
        vol_num: Set(vol_num),
        owned: Set(false),
        price: Set(None),
        store: Set(Some(String::new())),
        ..Default::default()
    };
    model.insert(db).await.map_err(AppError::from)
}

pub async fn add_volume_tx(
    conn: &impl ConnectionTrait,
    user_id: i32,
    mal_id: i32,
    vol_num: i32,
) -> Result<(), AppError> {
    let now = Utc::now();
    let model = ActiveModel {
        created_on: Set(now),
        modified_on: Set(now),
        user_id: Set(user_id),
        mal_id: Set(Some(mal_id)),
        vol_num: Set(vol_num),
        owned: Set(false),
        price: Set(None),
        store: Set(Some(String::new())),
        ..Default::default()
    };
    model.insert(conn).await.map_err(AppError::from)?;
    Ok(())
}

pub async fn delete_all_for_user_by_mal_id_tx(
    conn: &impl ConnectionTrait,
    user_id: i32,
    mal_id: i32,
) -> Result<(), AppError> {
    VolumeEntity::delete_many()
        .filter(volume::Column::UserId.eq(user_id))
        .filter(volume::Column::MalId.eq(mal_id))
        .exec(conn)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

pub async fn remove_volume_by_num(
    db: &Db,
    user_id: i32,
    mal_id: i32,
    vol_num: i32,
) -> Result<(), AppError> {
    VolumeEntity::delete_many()
        .filter(volume::Column::UserId.eq(user_id))
        .filter(volume::Column::MalId.eq(mal_id))
        .filter(volume::Column::VolNum.eq(vol_num))
        .exec(db)
        .await
        .map_err(AppError::from)?;
    Ok(())
}
