use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, Set,
};

use crate::db::Db;
use crate::errors::AppError;
use crate::models::activity::{self, event_types, ActiveModel, Activity, Entity as ActivityEntity};

/// Thresholds to emit milestone events on. We never emit the same milestone
/// twice for a given user — the check queries existing `milestone_*` entries.
pub const VOLUME_MILESTONES: &[i32] = &[10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
pub const SERIES_MILESTONES: &[i32] = &[5, 10, 25, 50, 100, 250, 500, 1000];

/// Fire-and-forget-style recording. Errors are logged and swallowed so that
/// a failure to persist an activity entry never blocks a mutation.
///
/// Stamps `created_on` with the current time. For events surfaced
/// through the coalescing buffer (where the original event time is
/// captured at buffer-entry and not at flush) use `record_at`.
pub async fn record(
    conn: &impl ConnectionTrait,
    user_id: i32,
    event_type: &str,
    mal_id: Option<i32>,
    vol_num: Option<i32>,
    name: Option<String>,
    count_value: Option<i32>,
) {
    record_at(
        conn,
        NewEvent {
            user_id,
            event_type,
            mal_id,
            vol_num,
            name,
            count_value,
        },
        Utc::now(),
    )
    .await;
}

/// Column payload for one activity-log row.
///
/// Grouped into a struct rather than passed as loose parameters because
/// `mal_id`, `vol_num` and `count_value` are all `Option<i32>` — three
/// mutually-assignable arguments that a positional call site can silently
/// transpose with no type error. Named fields make that impossible.
pub struct NewEvent<'a> {
    pub user_id: i32,
    pub event_type: &'a str,
    pub mal_id: Option<i32>,
    pub vol_num: Option<i32>,
    pub name: Option<String>,
    pub count_value: Option<i32>,
}

/// Like `record` but uses the supplied `created_on` instead of
/// `Utc::now()`. Used by the activity coalescer so that an event
/// flushed at +5 s still shows the timestamp of the original
/// click — keeps streak/heatmap math accurate.
pub async fn record_at(
    conn: &impl ConnectionTrait,
    event: NewEvent<'_>,
    created_on: chrono::DateTime<chrono::Utc>,
) {
    let (user_id, event_type) = (event.user_id, event.event_type);
    let model = ActiveModel {
        user_id: Set(user_id),
        event_type: Set(event_type.to_string()),
        mal_id: Set(event.mal_id),
        vol_num: Set(event.vol_num),
        name: Set(event.name),
        count_value: Set(event.count_value),
        created_on: Set(created_on),
        ..Default::default()
    };
    if let Err(err) = model.insert(conn).await {
        tracing::warn!(
            %err,
            event_type,
            user_id,
            "activity: failed to record event (non-fatal)"
        );
    }
}

/// 連 · Distinct activity days + streak summary.
///
/// `current_streak` counts the run of UTC days with activity that is
/// still alive: it ends today, or yesterday (the day is not over until
/// midnight UTC), or the day before with yesterday's absence still
/// forgivable (see `streak_of`).
///
/// `best_streak` is the longest run ever recorded, under the same rule.
/// Useful for the heatmap subtitle ("personal best: 47 days").
///
/// `last_active_date` is the most recent UTC day with activity,
/// formatted as ISO-8601 (`YYYY-MM-DD`) for the JSON wire — Rust's
/// chrono date serialises this way by default.
#[derive(Debug, serde::Serialize)]
pub struct StreakInfo {
    pub current_streak: i32,
    pub best_streak: i32,
    pub last_active_date: Option<chrono::NaiveDate>,
}

/// Active days a run needs between two forgiven absences.
pub const STREAK_GRACE_EVERY: i32 = 7;

/// 恕 · `(current, best)` for a set of active days.
///
/// A run is a sequence of active days; a single missed day does not end
/// it once the run has `STREAK_GRACE_EVERY` active days since its start
/// or since the last forgiven day — one per week of activity. The missed
/// day itself does not count. Two missed days in a row always end it.
///
/// A lost streak undoes weeks of habit for one bad day, and studies of
/// streak mechanics (Duolingo's freeze, the research on "what-the-hell"
/// effects) find that this is what drives readers away rather than
/// back; a grace that has to be earned keeps the count honest.
pub fn streak_of(
    days: &std::collections::BTreeSet<chrono::NaiveDate>,
    today: chrono::NaiveDate,
) -> (i32, i32) {
    let mut best = 0i32;
    let mut run = 0i32;
    // Active days since the run began or last used its grace.
    let mut earned = 0i32;
    let mut prev: Option<chrono::NaiveDate> = None;
    for &d in days {
        match prev.map(|p| d.signed_duration_since(p).num_days()) {
            Some(1) => {
                run += 1;
                earned += 1;
            }
            Some(2) if earned >= STREAK_GRACE_EVERY => {
                run += 1;
                earned = 1;
            }
            _ => {
                run = 1;
                earned = 1;
            }
        }
        best = best.max(run);
        prev = Some(d);
    }
    let alive = match prev.map(|last| today.signed_duration_since(last).num_days()) {
        Some(0 | 1) => true,
        // Yesterday is missing, but today can still bridge it.
        Some(2) => earned >= STREAK_GRACE_EVERY,
        _ => false,
    };
    (if alive { run } else { 0 }, best)
}

pub async fn compute_streak(db: &Db, user_id: i32) -> Result<StreakInfo, AppError> {
    // Pulls every activity row for the user, then folds into a set
    // of distinct UTC dates. For a power user with ~10k events that's
    // still well under a millisecond of memory work, and the I/O cost
    // (one indexed query) stays bounded — way simpler than a window-
    // function CTE without giving up much on hot paths.
    let rows = ActivityEntity::find()
        .filter(activity::Column::UserId.eq(user_id))
        .all(db)
        .await
        .map_err(AppError::from)?;

    let days: std::collections::BTreeSet<chrono::NaiveDate> = rows
        .into_iter()
        .map(|r| r.created_on.date_naive())
        .collect();
    let (current, best) = streak_of(&days, Utc::now().date_naive());

    Ok(StreakInfo {
        current_streak: current,
        best_streak: best,
        last_active_date: days.iter().next_back().copied(),
    })
}

pub async fn list_for_user(
    db: &Db,
    user_id: i32,
    limit: u64,
    before_id: Option<i32>,
) -> Result<Vec<Activity>, AppError> {
    let mut query = ActivityEntity::find()
        .filter(activity::Column::UserId.eq(user_id))
        .order_by_desc(activity::Column::CreatedOn)
        .order_by_desc(activity::Column::Id)
        .limit(limit);

    if let Some(before) = before_id {
        query = query.filter(activity::Column::Id.lt(before));
    }

    query.all(db).await.map_err(AppError::from)
}

/// Has the user already received this specific milestone? (Idempotent check.)
pub async fn milestone_already_recorded(
    conn: &impl ConnectionTrait,
    user_id: i32,
    event_type: &str,
    threshold: i32,
) -> Result<bool, AppError> {
    let existing = ActivityEntity::find()
        .filter(activity::Column::UserId.eq(user_id))
        .filter(activity::Column::EventType.eq(event_type))
        .filter(activity::Column::CountValue.eq(threshold))
        .one(conn)
        .await
        .map_err(AppError::from)?;
    Ok(existing.is_some())
}

/// Record series-count milestone if crossed. Call after any add/remove that
/// changes the number of series owned.
pub async fn check_series_milestone(conn: &impl ConnectionTrait, user_id: i32) {
    let count = match crate::models::library::Entity::find()
        .filter(crate::models::library::Column::UserId.eq(user_id))
        .count(conn)
        .await
    {
        Ok(c) => c as i32,
        Err(_) => return,
    };

    for &threshold in SERIES_MILESTONES.iter().rev() {
        if threshold > count {
            continue;
        }
        match milestone_already_recorded(conn, user_id, event_types::MILESTONE_SERIES, threshold)
            .await
        {
            Ok(true) => break,
            Ok(false) => {
                record(
                    conn,
                    user_id,
                    event_types::MILESTONE_SERIES,
                    None,
                    None,
                    None,
                    Some(threshold),
                )
                .await;
                break;
            }
            Err(_) => break,
        }
    }
}

/// Record volume-count milestone if crossed. Reads the current count from the
/// sum of `volumes_owned` across the user's library.
pub async fn check_volume_milestone(conn: &impl ConnectionTrait, user_id: i32) {
    use crate::models::library;
    use sea_orm::sea_query::Expr;

    // Milestone math degrades gracefully on DB trouble: treating the
    // aggregate as 0 means we simply don't fire a new milestone this
    // tick, which is strictly better than bubbling a 500 out of a
    // post-write activity hook. BUT the silent `.ok().flatten()` of
    // the previous implementation made that degradation invisible —
    // if the DB pool ever ran out, milestones just stopped firing
    // until a redeploy, with no log trail. Now we warn explicitly so
    // that sustained milestone silence is diagnosable.
    let total: Option<i64> = match library::Entity::find()
        .filter(library::Column::UserId.eq(user_id))
        .select_only()
        .column_as(Expr::col(library::Column::VolumesOwned).sum(), "sum")
        .into_tuple::<Option<i64>>()
        .one(conn)
        .await
    {
        Ok(opt) => opt.flatten(),
        Err(err) => {
            tracing::warn!(
                %err,
                user_id,
                "check_volume_milestone: aggregate query failed, treating as 0"
            );
            None
        }
    };

    let count = total.unwrap_or(0) as i32;

    for &threshold in VOLUME_MILESTONES.iter().rev() {
        if threshold > count {
            continue;
        }
        match milestone_already_recorded(conn, user_id, event_types::MILESTONE_VOLUMES, threshold)
            .await
        {
            Ok(true) => break,
            Ok(false) => {
                record(
                    conn,
                    user_id,
                    event_types::MILESTONE_VOLUMES,
                    None,
                    None,
                    None,
                    Some(threshold),
                )
                .await;
                break;
            }
            Err(_) => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{STREAK_GRACE_EVERY, streak_of};
    use chrono::NaiveDate;
    use std::collections::BTreeSet;

    fn day(n: i64) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 1, 1).unwrap() + chrono::Duration::days(n)
    }

    /// Active on the given day offsets.
    fn days(offsets: &[i64]) -> BTreeSet<NaiveDate> {
        offsets.iter().map(|&n| day(n)).collect()
    }

    fn range(from: i64, to: i64) -> Vec<i64> {
        (from..=to).collect()
    }

    #[test]
    fn nothing_counts_nothing() {
        assert_eq!(streak_of(&BTreeSet::new(), day(0)), (0, 0));
    }

    #[test]
    fn a_run_ending_today_or_yesterday_is_alive() {
        let three = days(&[7, 8, 9]);
        assert_eq!(streak_of(&three, day(9)), (3, 3));
        assert_eq!(streak_of(&three, day(10)), (3, 3));
        // Two days later, a short run has no grace to bridge yesterday.
        assert_eq!(streak_of(&three, day(11)), (0, 3));
    }

    #[test]
    fn one_missed_day_is_forgiven_after_a_week_of_activity() {
        // Days 0–7 (eight days), day 8 missed, days 9–10.
        let mut offsets = range(0, 7);
        offsets.extend([9, 10]);
        // The missed day does not count: 8 + 2.
        assert_eq!(streak_of(&days(&offsets), day(10)), (10, 10));
    }

    #[test]
    fn the_grace_has_to_be_earned() {
        // Five days, a miss, three days: two runs.
        let mut offsets = range(0, 4);
        offsets.extend([6, 7, 8]);
        assert_eq!(streak_of(&days(&offsets), day(8)), (3, 5));
    }

    #[test]
    fn a_second_miss_within_the_week_ends_the_run() {
        // Eight days, miss (forgiven), two days, miss again (not yet earned).
        let mut offsets = range(0, 7);
        offsets.extend([9, 10, 12, 13]);
        assert_eq!(streak_of(&days(&offsets), day(13)), (2, 10));
    }

    #[test]
    fn two_missed_days_in_a_row_always_end_it() {
        let mut offsets = range(0, 9);
        offsets.extend([12]);
        assert_eq!(streak_of(&days(&offsets), day(12)), (1, 10));
    }

    #[test]
    fn a_missed_yesterday_can_still_be_bridged_today() {
        // A week's run that ended the day before yesterday stays alive:
        // acting today would bridge yesterday.
        let week = days(&range(0, STREAK_GRACE_EVERY as i64 - 1));
        let last = STREAK_GRACE_EVERY as i64 - 1;
        assert_eq!(
            streak_of(&week, day(last + 2)),
            (STREAK_GRACE_EVERY, STREAK_GRACE_EVERY)
        );
        // A day later it is gone.
        assert_eq!(streak_of(&week, day(last + 3)), (0, STREAK_GRACE_EVERY));
    }

    #[test]
    fn grace_comes_back_after_another_week() {
        // 7 days, miss, 7 days, miss, 1 day: both misses forgiven.
        let mut offsets = range(0, 6);
        offsets.extend(range(8, 14));
        offsets.extend([16]);
        assert_eq!(streak_of(&days(&offsets), day(16)), (15, 15));
    }
}
