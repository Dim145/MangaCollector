use chrono::Utc;
use rust_decimal::Decimal;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set,
};

use crate::db::Db;
use crate::errors::AppError;
use crate::models::activity::event_types;
use crate::models::coffret::STORE_MAX_LEN;
use crate::models::library::{self as library_mod, Entity as LibraryEntity, sanitize_label};
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
    // 店 · Trim + length-clamp the store label. Frontend
    // `<StoreAutocomplete>` defaults to `maxLength={STORE_MAX_LEN}`
    // (mirroring this constant); a malicious client bypassing the UI
    // hits the cap here. `None` and empty/whitespace-only both fold to
    // None — same "clear this column" contract as publisher / edition.
    let store = sanitize_label(store, STORE_MAX_LEN);

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

/// 一括 · Cascade `owned` and/or `read` to every released volume of a
/// series in one shot. Used by the dashboard's bulk-actions bar so a
/// "mark this series as fully owned" click sets every individual
/// volume row (not just the denormalised counter on the library row).
///
/// Upcoming volumes (`release_date > now`) are intentionally excluded:
/// they're announced-but-not-shipped tomes, and the rest of the
/// system enforces `owned = false` / `read_at = NULL` on them. A bulk
/// op shouldn't break that invariant.
///
/// `owned` and `read` are independent and both `Option`. Passing
/// `None` for either leaves it untouched. Passing `Some(false)` for
/// `read` clears the timestamp (NULL); `Some(true)` stamps `now()`.
///
/// After the cascade the library's `volumes_owned` counter is
/// recomputed from the actual volume rows to keep the dashboard's
/// progress numbers in sync.
pub async fn bulk_mark_for_series(
    db: &Db,
    user_id: i32,
    mal_id: i32,
    owned: Option<bool>,
    read: Option<bool>,
) -> Result<(), AppError> {
    use sea_orm::{Condition, PaginatorTrait, sea_query::Expr};

    if owned.is_none() && read.is_none() {
        return Ok(());
    }

    let now = Utc::now();

    // Released-only filter: NULL release_date (no announcement → it
    // shipped) or release_date <= now. Same predicate the per-row
    // path uses to gate the upcoming guardrail.
    let released_filter = Condition::any()
        .add(volume::Column::ReleaseDate.is_null())
        .add(volume::Column::ReleaseDate.lte(now));

    // SeaORM's `update_many` accepts a chain of `.col_expr` calls. We
    // build the chain conditionally so a partial update (just
    // `owned`, or just `read`) doesn't write columns the caller
    // didn't ask for.
    let mut updater = VolumeEntity::update_many()
        .filter(volume::Column::UserId.eq(user_id))
        .filter(volume::Column::MalId.eq(mal_id))
        .filter(released_filter);

    if let Some(o) = owned {
        updater = updater.col_expr(volume::Column::Owned, Expr::value(o));
    }
    if let Some(r) = read {
        let value: Option<chrono::DateTime<chrono::Utc>> = if r { Some(now) } else { None };
        updater = updater.col_expr(volume::Column::ReadAt, Expr::value(value));
    }
    updater = updater.col_expr(volume::Column::ModifiedOn, Expr::value(now));
    updater.exec(db).await.map_err(AppError::from)?;

    // Recompute the library counter when ownership was the lever
    // changed — a true cascade should reflect on the dashboard's
    // "x / y volumes" stat without a separate refetch.
    if owned.is_some() {
        let owned_count = VolumeEntity::find()
            .filter(volume::Column::UserId.eq(user_id))
            .filter(volume::Column::MalId.eq(mal_id))
            .filter(volume::Column::Owned.eq(true))
            .count(db)
            .await
            .map_err(AppError::from)? as i32;

        let lib_row = LibraryEntity::find()
            .filter(library_mod::Column::UserId.eq(user_id))
            .filter(library_mod::Column::MalId.eq(mal_id))
            .one(db)
            .await
            .map_err(AppError::from)?;

        if let Some(existing) = lib_row {
            let total_volumes = existing.volumes;
            let previous_owned = existing.volumes_owned;
            let series_name = existing.name.clone();
            let mut active: library_mod::ActiveModel = existing.into();
            active.volumes_owned = Set(owned_count);
            active.modified_on = Set(now);
            active.update(db).await.map_err(AppError::from)?;

            // Completion milestone — same trigger as the per-row
            // `update_volumes_owned`. Bulk ops can flip a series to
            // complete in one click; we want the activity feed +
            // seal grant to fire just once.
            if total_volumes > 0
                && previous_owned < total_volumes
                && owned_count >= total_volumes
            {
                activity::record(
                    db,
                    user_id,
                    event_types::SERIES_COMPLETED,
                    Some(mal_id),
                    None,
                    Some(series_name),
                    Some(total_volumes),
                )
                .await;
            }
        }

        activity::check_volume_milestone(db, user_id).await;
    }

    Ok(())
}

/// 来 · Manually create an upcoming-volume row.
///
/// Mirrors the API-cascade insert path in `services::releases::reconcile_user`,
/// but with two key differences:
///   1. `origin = "manual"` — the nightly sweep is forbidden from
///      touching this row even if the auto-cascade later finds a
///      conflicting date for the same vol_num.
///   2. The caller chose every value (date, ISBN, URL) — we validate
///      shape but never override the user's intent.
///
/// The function refuses to create a row if:
///   * `release_date` is in the past (or now) — a tome already out
///     should not be marked "upcoming".
///   * `release_isbn` is non-empty but not 10/13 ASCII digits (allowing
///     a trailing `X` for the legacy ISBN-10 check digit).
///   * `release_url` is non-empty and lacks an `http://` / `https://`
///     scheme.
///   * The series is not in the user's library — same authz gate as
///     `reconcile_user`.
///   * A row already exists at `(user_id, mal_id, vol_num)`. The DB
///     would catch this via the partial unique index, but we surface
///     it as a 409 instead of a 500 so the SPA can inline a clear
///     "tome déjà existant" hint.
pub async fn add_upcoming_manually(
    db: &Db,
    user_id: i32,
    mal_id: i32,
    vol_num: i32,
    release_date: chrono::DateTime<chrono::Utc>,
    release_isbn: Option<String>,
    release_url: Option<String>,
) -> Result<Volume, AppError> {
    let now = Utc::now();

    if vol_num < 1 {
        return Err(AppError::BadRequest(
            "vol_num must be a positive integer".into(),
        ));
    }
    if release_date <= now {
        return Err(AppError::BadRequest(
            "release_date must be strictly in the future".into(),
        ));
    }

    // Authz gate — the user must already follow this series. Without
    // this check, a malicious caller could probe arbitrary mal_ids
    // and inflate the volume table with orphan rows.
    let owns_series = LibraryEntity::find()
        .filter(library_mod::Column::UserId.eq(user_id))
        .filter(library_mod::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?
        .is_some();
    if !owns_series {
        return Err(AppError::NotFound("Library entry not found".into()));
    }

    // ISBN-13 / ISBN-10 — strip cosmetic separators and verify digit count.
    let normalised_isbn = match release_isbn.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(raw) => {
            let cleaned: String = raw
                .chars()
                .filter(|c| c.is_ascii_digit() || *c == 'X' || *c == 'x')
                .map(|c| c.to_ascii_uppercase())
                .collect();
            if !(cleaned.len() == 10 || cleaned.len() == 13) {
                return Err(AppError::BadRequest(
                    "ISBN must be 10 or 13 characters once dashes/spaces are stripped".into(),
                ));
            }
            Some(cleaned)
        }
    };

    // URL — only `http(s)://` is allowed. We don't try to verify the
    // host resolves, only that the value is not a `javascript:` payload
    // or a relative path that would mismount on click.
    let normalised_url = match release_url.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(raw) => {
            if !(raw.starts_with("http://") || raw.starts_with("https://")) {
                return Err(AppError::BadRequest(
                    "release_url must start with http:// or https://".into(),
                ));
            }
            Some(raw.to_string())
        }
    };

    // Pre-check for duplicates so we can return a meaningful 409.
    let already = VolumeEntity::find()
        .filter(volume::Column::UserId.eq(user_id))
        .filter(volume::Column::MalId.eq(mal_id))
        .filter(volume::Column::VolNum.eq(vol_num))
        .one(db)
        .await
        .map_err(AppError::from)?;
    if already.is_some() {
        return Err(AppError::Conflict(
            "A volume already exists at this number for this series".into(),
        ));
    }

    let model = ActiveModel {
        created_on: Set(now),
        modified_on: Set(now),
        user_id: Set(user_id),
        mal_id: Set(Some(mal_id)),
        vol_num: Set(vol_num),
        owned: Set(false),
        price: Set(None),
        store: Set(Some(String::new())),
        collector: Set(false),
        coffret_id: Set(None),
        read_at: Set(None),
        release_date: Set(Some(release_date)),
        release_isbn: Set(normalised_isbn),
        release_url: Set(normalised_url),
        origin: Set("manual".to_string()),
        announced_at: Set(Some(now)),
        ..Default::default()
    };

    let inserted = model.insert(db).await.map_err(AppError::from)?;
    Ok(inserted)
}

/// 来 · Update the announce-side fields of an existing
/// `origin = "manual"` upcoming row. Refuses on API-origin rows so
/// the nightly sweep keeps authority over what it produced.
///
/// The owned/read/collector axes are NOT updatable here — the regular
/// `update_by_id` path already handles those (and applies the upcoming
/// guardrail that forces them off while the row is still in the future).
pub async fn update_upcoming_manually(
    db: &Db,
    id: i32,
    user_id: i32,
    release_date: chrono::DateTime<chrono::Utc>,
    release_isbn: Option<String>,
    release_url: Option<String>,
) -> Result<Volume, AppError> {
    let now = Utc::now();
    if release_date <= now {
        return Err(AppError::BadRequest(
            "release_date must be strictly in the future".into(),
        ));
    }

    // Same shape validation as the create path.
    let normalised_isbn = match release_isbn.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(raw) => {
            let cleaned: String = raw
                .chars()
                .filter(|c| c.is_ascii_digit() || *c == 'X' || *c == 'x')
                .map(|c| c.to_ascii_uppercase())
                .collect();
            if !(cleaned.len() == 10 || cleaned.len() == 13) {
                return Err(AppError::BadRequest(
                    "ISBN must be 10 or 13 characters once dashes/spaces are stripped".into(),
                ));
            }
            Some(cleaned)
        }
    };
    let normalised_url = match release_url.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(raw) => {
            if !(raw.starts_with("http://") || raw.starts_with("https://")) {
                return Err(AppError::BadRequest(
                    "release_url must start with http:// or https://".into(),
                ));
            }
            Some(raw.to_string())
        }
    };

    // Fetch the row scoped to the caller — same defence-in-depth as
    // `update_by_id`. Refuse if the row doesn't belong to the user OR
    // if its origin isn't "manual".
    let existing = VolumeEntity::find()
        .filter(volume::Column::Id.eq(id))
        .filter(volume::Column::UserId.eq(user_id))
        .one(db)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound("Volume not found".into()))?;
    if existing.origin != "manual" {
        return Err(AppError::Conflict(
            "Only manual upcoming volumes can be edited this way".into(),
        ));
    }

    let mut active: ActiveModel = existing.into();
    active.release_date = Set(Some(release_date));
    active.release_isbn = Set(normalised_isbn);
    active.release_url = Set(normalised_url);
    active.modified_on = Set(now);
    let updated = active.update(db).await.map_err(AppError::from)?;
    Ok(updated)
}

/// 消 · Delete a volume row.
///
/// Limited by design to `origin = "manual"` rows. API-origin rows are
/// re-created by the nightly sweep, so a delete on those would just
/// resurrect the row on the next refresh — surprising the user. We
/// refuse instead and let the caller manage that side via the regular
/// "release date passed → flips back to a normal volume" lifecycle.
pub async fn delete_manual_volume(
    db: &Db,
    id: i32,
    user_id: i32,
) -> Result<(), AppError> {
    let existing = VolumeEntity::find()
        .filter(volume::Column::Id.eq(id))
        .filter(volume::Column::UserId.eq(user_id))
        .one(db)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound("Volume not found".into()))?;
    if existing.origin != "manual" {
        return Err(AppError::Conflict(
            "Only manual upcoming volumes can be deleted".into(),
        ));
    }
    VolumeEntity::delete_many()
        .filter(volume::Column::Id.eq(id))
        .filter(volume::Column::UserId.eq(user_id))
        .exec(db)
        .await
        .map_err(AppError::from)?;
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
