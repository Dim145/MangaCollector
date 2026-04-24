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
pub async fn record(
    conn: &impl ConnectionTrait,
    user_id: i32,
    event_type: &str,
    mal_id: Option<i32>,
    vol_num: Option<i32>,
    name: Option<String>,
    count_value: Option<i32>,
) {
    let now = Utc::now();
    let model = ActiveModel {
        user_id: Set(user_id),
        event_type: Set(event_type.to_string()),
        mal_id: Set(mal_id),
        vol_num: Set(vol_num),
        name: Set(name),
        count_value: Set(count_value),
        created_on: Set(now),
        ..Default::default()
    };
    if let Err(err) = model.insert(conn).await {
        // Previously `eprintln!`, which bypassed the tracing subscriber
        // and the structured log format used everywhere else. Use
        // `tracing::warn!` so operators get consistent formatting and
        // can filter the event type.
        tracing::warn!(
            %err,
            event_type,
            user_id,
            "activity: failed to record event (non-fatal)"
        );
    }
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
