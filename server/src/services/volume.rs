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
    self, ActiveLoan, ActiveModel, Entity as VolumeEntity, LOAN_BORROWER_MAX_CHARS,
    LoanPatch, NOTE_MAX_CHARS, Volume,
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

/// 来 · Force-zero the "I have this" axes when the row is upcoming.
///
/// A future-dated announcement can't be owned, read, or marked
/// collector. Coerced silently (not 400) so a stale outbox entry
/// replayed after the announcement landed doesn't jam the sync
/// loop. Returns `(owned, collector, read)`.
fn coerce_upcoming_flags(
    is_upcoming: bool,
    owned: bool,
    collector: bool,
    read: Option<bool>,
) -> (bool, bool, Option<bool>) {
    if is_upcoming {
        (false, false, Some(false))
    } else {
        (owned, collector, read)
    }
}

/// Three-way reading-status semantics:
///   • `None`        → leave the column alone
///   • `Some(true)`  → stamp NOW iff currently NULL (preserves the
///                     original read date across toggles)
///   • `Some(false)` → clear to NULL
fn apply_read_transition<E>(
    query: sea_orm::UpdateMany<E>,
    read: Option<bool>,
    existing: Option<&volume::Model>,
    now: chrono::DateTime<chrono::Utc>,
) -> sea_orm::UpdateMany<E>
where
    E: EntityTrait<Column = volume::Column>,
{
    match read {
        None => query,
        Some(true) => {
            let already_read = existing.and_then(|r| r.read_at).is_some();
            if already_read {
                query
            } else {
                query.col_expr(volume::Column::ReadAt, now.into())
            }
        }
        Some(false) => query.col_expr(
            volume::Column::ReadAt,
            sea_orm::sea_query::Expr::value(Option::<chrono::DateTime<chrono::Utc>>::None),
        ),
    }
}

/// 預け · Auto-clear the loan triplet when ownership transitions
/// from owned → unowned. A volume the user no longer owns can't
/// logically still be on loan; without this clear, the loan would
/// stay stuck in the DB invisible to the loan UI (the LoanChip is
/// gated on `ownedStatus`).
fn auto_clear_loan_if_unown<E>(
    query: sea_orm::UpdateMany<E>,
    was_owned: bool,
    owned: bool,
) -> sea_orm::UpdateMany<E>
where
    E: EntityTrait<Column = volume::Column>,
{
    if !(was_owned && !owned) {
        return query;
    }
    query
        .col_expr(
            volume::Column::LoanedTo,
            sea_orm::sea_query::Expr::value(Option::<String>::None),
        )
        .col_expr(
            volume::Column::LoanStartedAt,
            sea_orm::sea_query::Expr::value(
                Option::<chrono::DateTime<chrono::Utc>>::None,
            ),
        )
        .col_expr(
            volume::Column::LoanDueAt,
            sea_orm::sea_query::Expr::value(
                Option::<chrono::DateTime<chrono::Utc>>::None,
            ),
        )
}

// 9 positional args — acknowledged. Wrapping in a struct here would
// require touching every caller (handler + activity emitter + test
// fixture); the call site is also internal, never user-facing API.
// The named record is the *contract* in models::volume::PatchVolume,
// this fn is the dispatcher behind it.
#[allow(clippy::too_many_arguments)]
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
    // Idempotent on two axes — a row that no longer exists (offline
    // outbox replay after deletion) and a row that exists under
    // another user (IDOR attempt or stale client state). Both paths
    // return Ok without touching the DB. The caller doesn't need to
    // distinguish, and we never leak existence info.
    let now = Utc::now();
    let store = sanitize_label(store, STORE_MAX_LEN);

    let existing = VolumeEntity::find()
        .filter(volume::Column::Id.eq(id))
        .filter(volume::Column::UserId.eq(user_id))
        .one(db)
        .await
        .map_err(AppError::from)?;

    let is_upcoming = existing
        .as_ref()
        .and_then(|r| r.release_date)
        .map(|d| d > now)
        .unwrap_or(false);
    let (owned, collector, read) = coerce_upcoming_flags(is_upcoming, owned, collector, read);

    // Second-line authz: scope the UPDATE itself by (id, user_id).
    // Even if `existing` were wrong somehow, the DB refuses to touch
    // rows owned by anyone else.
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
    // partial PATCH (price-only) can't accidentally wipe a note
    // set by a later request that already landed.
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

    query = apply_read_transition(query, read, existing.as_ref(), now);

    let was_owned = existing.as_ref().is_some_and(|r| r.owned);
    query = auto_clear_loan_if_unown(query, was_owned, owned);

    query.exec(db).await.map_err(AppError::from)?;

    // Log ownership transitions only — price/store edits alone don't produce
    // an activity entry.
    if let Some(prev) = existing
        && prev.owned != owned {
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

    Ok(())
}

/// 預け · Apply a loan-state mutation to a single volume.
///
/// `patch` arity:
///   - `None` → clear all three loan columns (volume returned)
///   - `Some(LoanPatch { to, due_at })` → mark as lent, capturing the
///     borrower handle and an optional due date. `loan_started_at` is
///     set to NOW iff the volume isn't already lent — this preserves
///     the original lend date when the user only edits the due date.
///
/// Same horizontal-authz gate as `update_by_id`: the (id, user_id)
/// filter is mandatory; an attacker can't lend someone else's volume.
/// Empty / whitespace-only borrower names are rejected — clearing the
/// loan needs `Some(None)` from the caller, not `Some(Some(""))`.
pub async fn set_loan(
    db: &Db,
    id: i32,
    user_id: i32,
    patch: Option<LoanPatch>,
) -> Result<(), AppError> {
    let now = Utc::now();
    let existing = VolumeEntity::find()
        .filter(volume::Column::Id.eq(id))
        .filter(volume::Column::UserId.eq(user_id))
        .one(db)
        .await
        .map_err(AppError::from)?;
    let Some(existing) = existing else {
        // No row to mutate — same forgiving policy as `update_by_id`.
        return Ok(());
    };

    let mut active: ActiveModel = existing.clone().into();
    match patch {
        None => {
            // Return path — clear all three columns. Allowed
            // unconditionally: even if the volume was somehow
            // marked as lent on a non-owned row (legacy data, race
            // with an unown op), clearing the loan is a strict
            // improvement and should never error.
            active.loaned_to = Set(None);
            active.loan_started_at = Set(None);
            active.loan_due_at = Set(None);
        }
        Some(p) => {
            // 預け · Lending requires real ownership. You can't
            // hand someone what isn't yours. The check covers two
            // states: the volume isn't currently owned, OR it's
            // an upcoming announcement (release_date in the future,
            // owned forced to false by upstream invariants). Both
            // surface the same `BadRequest`; the SPA already gates
            // the loan UI on `ownedStatus && !isUpcoming` so the
            // server-side reject is defense in depth, not a primary
            // signal.
            if !existing.owned {
                return Err(AppError::BadRequest(
                    "Cannot lend a volume that is not currently owned.".into(),
                ));
            }
            let is_upcoming = existing
                .release_date
                .map(|d| d > now)
                .unwrap_or(false);
            if is_upcoming {
                return Err(AppError::BadRequest(
                    "Cannot lend an upcoming volume.".into(),
                ));
            }
            let trimmed = p.to.trim();
            if trimmed.is_empty() {
                return Err(AppError::BadRequest(
                    "Borrower name is required when setting a loan.".into(),
                ));
            }
            let name: String = trimmed.chars().take(LOAN_BORROWER_MAX_CHARS).collect();
            active.loaned_to = Set(Some(name));
            // Preserve the existing started_at if the volume was already
            // lent — this is an "edit" path (e.g. updating the due date).
            // Mint a new started_at only on first lend.
            if existing.loan_started_at.is_none() {
                active.loan_started_at = Set(Some(now));
            }
            active.loan_due_at = Set(p.due_at);
        }
    }
    active.modified_on = Set(now);
    active.update(db).await.map_err(AppError::from)?;
    Ok(())
}

/// 預け · Listing endpoint backing the dashboard "outstanding loans"
/// widget. Returns every volume currently lent by the caller, joined
/// with the parent series name + cover URL for friendly rendering.
/// Sorted by due date ascending so overdue loans surface first;
/// undated loans (no due_at) sink to the bottom.
pub async fn list_active_loans(db: &Db, user_id: i32) -> Result<Vec<ActiveLoan>, AppError> {
    let rows = VolumeEntity::find()
        .filter(volume::Column::UserId.eq(user_id))
        .filter(volume::Column::LoanedTo.is_not_null())
        .all(db)
        .await
        .map_err(AppError::from)?;
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    // Single batched library lookup to attach series_name + cover URL.
    let mal_ids: std::collections::HashSet<i32> = rows.iter().filter_map(|v| v.mal_id).collect();
    let lib_rows = if mal_ids.is_empty() {
        Vec::new()
    } else {
        LibraryEntity::find()
            .filter(library_mod::Column::UserId.eq(user_id))
            .filter(library_mod::Column::MalId.is_in(mal_ids))
            .all(db)
            .await
            .map_err(AppError::from)?
    };
    let mut name_lookup: std::collections::HashMap<i32, (String, Option<String>)> =
        std::collections::HashMap::new();
    for r in lib_rows {
        if let Some(m) = r.mal_id {
            name_lookup.insert(m, (r.name, r.image_url_jpg));
        }
    }
    let mut loans: Vec<ActiveLoan> = rows
        .into_iter()
        .filter_map(|v| {
            let started = v.loan_started_at?;
            let to = v.loaned_to?;
            let (series_name, series_image_url) = v
                .mal_id
                .and_then(|m| name_lookup.get(&m))
                .map(|p| (Some(p.0.clone()), p.1.clone()))
                .unwrap_or((None, None));
            Some(ActiveLoan {
                volume_id: v.id,
                mal_id: v.mal_id,
                vol_num: v.vol_num,
                series_name,
                series_image_url,
                loaned_to: to,
                loan_started_at: started,
                loan_due_at: v.loan_due_at,
            })
        })
        .collect();
    // Overdue first, then by due date asc, then undated last.
    loans.sort_by(|a, b| match (a.loan_due_at, b.loan_due_at) {
        (Some(x), Some(y)) => x.cmp(&y),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a.loan_started_at.cmp(&b.loan_started_at),
    });
    Ok(loans)
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
/// 国際標準図書番号 · Strip cosmetic separators (dashes, spaces) from
/// an ISBN candidate and verify the remaining digit count is 10 or
/// 13. Returns `Ok(None)` when the input is empty/whitespace-only.
fn normalize_release_isbn(raw: Option<&str>) -> Result<Option<String>, AppError> {
    match raw.map(str::trim) {
        None | Some("") => Ok(None),
        Some(s) => {
            let cleaned: String = s
                .chars()
                .filter(|c| c.is_ascii_digit() || *c == 'X' || *c == 'x')
                .map(|c| c.to_ascii_uppercase())
                .collect();
            if !(cleaned.len() == 10 || cleaned.len() == 13) {
                return Err(AppError::BadRequest(
                    "ISBN must be 10 or 13 characters once dashes/spaces are stripped".into(),
                ));
            }
            Ok(Some(cleaned))
        }
    }
}

/// Validate a release-page URL: only `http(s)://` schemes accepted.
/// We don't probe DNS — just refuse anything that could mismount on
/// click (`javascript:` / relative paths / data URIs).
fn normalize_release_url(raw: Option<&str>) -> Result<Option<String>, AppError> {
    match raw.map(str::trim) {
        None | Some("") => Ok(None),
        Some(s) => {
            if !(s.starts_with("http://") || s.starts_with("https://")) {
                return Err(AppError::BadRequest(
                    "release_url must start with http:// or https://".into(),
                ));
            }
            Ok(Some(s.to_string()))
        }
    }
}

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

    let normalised_isbn = normalize_release_isbn(release_isbn.as_deref())?;
    let normalised_url = normalize_release_url(release_url.as_deref())?;

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

    let normalised_isbn = normalize_release_isbn(release_isbn.as_deref())?;
    let normalised_url = normalize_release_url(release_url.as_deref())?;

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

pub async fn remove_volume_by_num_tx(
    conn: &impl ConnectionTrait,
    user_id: i32,
    mal_id: i32,
    vol_num: i32,
) -> Result<(), AppError> {
    VolumeEntity::delete_many()
        .filter(volume::Column::UserId.eq(user_id))
        .filter(volume::Column::MalId.eq(mal_id))
        .filter(volume::Column::VolNum.eq(vol_num))
        .exec(conn)
        .await
        .map_err(AppError::from)?;
    Ok(())
}
