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
        user_id,
        event_type,
        mal_id,
        vol_num,
        name,
        count_value,
        Utc::now(),
    )
    .await;
}

/// Like `record` but uses the supplied `created_on` instead of
/// `Utc::now()`. Used by the activity coalescer so that an event
/// flushed at +5 s still shows the timestamp of the original
/// click — keeps streak/heatmap math accurate.
pub async fn record_at(
    conn: &impl ConnectionTrait,
    user_id: i32,
    event_type: &str,
    mal_id: Option<i32>,
    vol_num: Option<i32>,
    name: Option<String>,
    count_value: Option<i32>,
    created_on: chrono::DateTime<chrono::Utc>,
) {
    let model = ActiveModel {
        user_id: Set(user_id),
        event_type: Set(event_type.to_string()),
        mal_id: Set(mal_id),
        vol_num: Set(vol_num),
        name: Set(name),
        count_value: Set(count_value),
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
/// `current_streak` counts the number of consecutive UTC days
/// ending at TODAY (or YESTERDAY — if the user did nothing today
/// yet, the streak isn't broken until midnight UTC) where the user
/// has at least one activity-log entry.
///
/// `best_streak` is the maximum consecutive run ever recorded.
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

    if rows.is_empty() {
        return Ok(StreakInfo {
            current_streak: 0,
            best_streak: 0,
            last_active_date: None,
        });
    }

    let mut days: std::collections::BTreeSet<chrono::NaiveDate> = rows
        .into_iter()
        .map(|r| r.created_on.date_naive())
        .collect();

    let last = days.iter().next_back().copied();
    let today = Utc::now().date_naive();

    // Best streak — single pass through the sorted set.
    let mut best = 0i32;
    let mut run = 0i32;
    let mut prev: Option<chrono::NaiveDate> = None;
    for &d in days.iter() {
        run = match prev {
            Some(p) if d.signed_duration_since(p).num_days() == 1 => run + 1,
            _ => 1,
        };
        if run > best {
            best = run;
        }
        prev = Some(d);
    }

    // Current streak — walk backwards from today/yesterday.
    let mut current = 0i32;
    // Allow a one-day grace at the start of the day (UTC) so the
    // streak doesn't visually "break" between midnight and the
    // user's first activity of the new day.
    let anchor = if days.contains(&today) {
        Some(today)
    } else {
        let yesterday = today.pred_opt();
        yesterday.filter(|d| days.contains(d))
    };
    if let Some(mut d) = anchor {
        loop {
            if !days.remove(&d) {
                break;
            }
            current += 1;
            match d.pred_opt() {
                Some(p) => d = p,
                None => break,
            }
        }
    }

    Ok(StreakInfo {
        current_streak: current,
        best_streak: best,
        last_active_date: last,
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
