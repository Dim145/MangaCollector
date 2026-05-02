//! 友 Tomo · Follow + activity-feed service.
//!
//! The user model is "subscribe to public profiles, see their
//! activity in a feed". One-way relationship; no mutuality requirement.
//!
//! Privacy gates:
//!   - Following requires the target to have a `public_slug` set
//!     (i.e. they have a public profile).
//!   - The feed filter respects the same predicate at read time —
//!     a user who flips their profile private mid-stream stops
//!     appearing in their followers' feeds without us cascade-
//!     deleting the follow rows. (When they re-publish, the feed
//!     resumes.)
//!   - Self-follow is rejected at the DB level via a CHECK constraint.

use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QuerySelect, Set,
    sea_query::{Alias, Expr, OnConflict, Query},
};

use crate::db::Db;
use crate::errors::AppError;
use crate::models::activity;
use crate::models::follow::{self, ActiveModel, Entity as FollowEntity, FeedEntry, FollowedUser};
use crate::models::user::{self, Entity as UserEntity};

/// Default page size for the activity feed. Caller can override via
/// the handler's query string; clamped to FEED_LIMIT_MAX inside the
/// service.
pub const FEED_LIMIT_DEFAULT: u64 = 50;
pub const FEED_LIMIT_MAX: u64 = 200;

/// Resolve a public_slug to a user_id, refusing if the target has
/// no public profile (i.e. `public_slug IS NULL`). The public_slug
/// is stored case-folded already, so we don't re-normalise here.
async fn resolve_slug_to_user(db: &Db, slug: &str) -> Result<i32, AppError> {
    let trimmed = slug.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("Slug is required.".into()));
    }
    let row = UserEntity::find()
        .filter(user::Column::PublicSlug.eq(trimmed))
        .select_only()
        .column(user::Column::Id)
        .into_tuple::<i32>()
        .one(db)
        .await
        .map_err(AppError::from)?;
    row.ok_or_else(|| AppError::NotFound("User not found".into()))
}

/// Follow a user identified by their public slug. Idempotent — a
/// repeat follow is a no-op (ON CONFLICT DO NOTHING).
pub async fn follow_by_slug(db: &Db, follower_id: i32, slug: &str) -> Result<(), AppError> {
    let target = resolve_slug_to_user(db, slug).await?;
    if target == follower_id {
        return Err(AppError::BadRequest("Cannot follow yourself.".into()));
    }
    let now = chrono::Utc::now();
    let model = ActiveModel {
        follower_id: Set(follower_id),
        following_id: Set(target),
        created_at: Set(now),
    };
    FollowEntity::insert(model)
        .on_conflict(
            OnConflict::columns([
                follow::Column::FollowerId,
                follow::Column::FollowingId,
            ])
            .do_nothing()
            .to_owned(),
        )
        .exec_without_returning(db)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

/// Unfollow by slug. Idempotent — removing a non-existent follow
/// silently succeeds (no point distinguishing).
pub async fn unfollow_by_slug(db: &Db, follower_id: i32, slug: &str) -> Result<(), AppError> {
    let target = resolve_slug_to_user(db, slug).await?;
    FollowEntity::delete_many()
        .filter(follow::Column::FollowerId.eq(follower_id))
        .filter(follow::Column::FollowingId.eq(target))
        .exec(db)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

/// List every user the caller follows, joined with display info.
/// Filters at read time on `public_slug IS NOT NULL` so a target
/// who flipped private disappears from the list (without us deleting
/// the follow row — they may flip back).
pub async fn list_following(
    db: &Db,
    follower_id: i32,
) -> Result<Vec<FollowedUser>, AppError> {
    // Build a single-shot query that joins user_follows with users
    // on `following_id = users.id`, filtering out targets without a
    // public_slug. SeaORM's typed-tuple path keeps it concise.
    use sea_orm::FromQueryResult;
    #[derive(FromQueryResult)]
    struct Row {
        user_id: i32,
        public_slug: String,
        display_name: Option<String>,
        followed_at: chrono::DateTime<chrono::Utc>,
    }

    let stmt = Query::select()
        // Alias `following_id` as `user_id` so the projection matches
        // the FromQueryResult struct field above. Without the alias
        // SeaORM returns the raw column name `following_id` and
        // FromQueryResult fails with "no column found for name: user_id".
        .expr_as(
            Expr::col((follow::Entity, follow::Column::FollowingId)),
            Alias::new("user_id"),
        )
        .expr_as(
            Expr::col((user::Entity, user::Column::PublicSlug)),
            Alias::new("public_slug"),
        )
        .expr_as(
            Expr::col((user::Entity, user::Column::Name)),
            Alias::new("display_name"),
        )
        .expr_as(
            Expr::col((follow::Entity, follow::Column::CreatedAt)),
            Alias::new("followed_at"),
        )
        .from(follow::Entity)
        .inner_join(
            user::Entity,
            Expr::col((user::Entity, user::Column::Id))
                .equals((follow::Entity, follow::Column::FollowingId)),
        )
        .and_where(Expr::col((follow::Entity, follow::Column::FollowerId)).eq(follower_id))
        .and_where(Expr::col((user::Entity, user::Column::PublicSlug)).is_not_null())
        .order_by(
            (follow::Entity, follow::Column::CreatedAt),
            sea_orm::Order::Desc,
        )
        .to_owned();

    let rows: Vec<Row> = Row::find_by_statement(db.get_database_backend().build(&stmt))
        .all(db)
        .await
        .map_err(AppError::from)?;

    Ok(rows
        .into_iter()
        .map(|r| FollowedUser {
            user_id: r.user_id,
            public_slug: r.public_slug,
            display_name: r.display_name,
            followed_at: r.followed_at,
        })
        .collect())
}

/// Aggregate activity feed across every user the caller follows.
/// Joins activity_log with users to attach display info. Filters
/// out events from users whose public_slug has been cleared.
///
/// `limit` is clamped to FEED_LIMIT_MAX. Results are ordered by
/// `created_on DESC` so newest events surface first.
pub async fn feed(db: &Db, follower_id: i32, limit: u64) -> Result<Vec<FeedEntry>, AppError> {
    let limit = limit.clamp(1, FEED_LIMIT_MAX);

    use sea_orm::FromQueryResult;
    #[derive(FromQueryResult)]
    struct Row {
        event_id: i32,
        actor_user_id: i32,
        actor_slug: String,
        actor_display_name: Option<String>,
        event_type: String,
        mal_id: Option<i32>,
        vol_num: Option<i32>,
        series_name: Option<String>,
        volume_count: Option<i32>,
        created_at: chrono::DateTime<chrono::Utc>,
    }

    let stmt = Query::select()
        .expr_as(
            Expr::col((activity::Entity, activity::Column::Id)),
            Alias::new("event_id"),
        )
        .expr_as(
            Expr::col((activity::Entity, activity::Column::UserId)),
            Alias::new("actor_user_id"),
        )
        .expr_as(
            Expr::col((user::Entity, user::Column::PublicSlug)),
            Alias::new("actor_slug"),
        )
        .expr_as(
            Expr::col((user::Entity, user::Column::Name)),
            Alias::new("actor_display_name"),
        )
        .columns([
            (activity::Entity, activity::Column::EventType),
            (activity::Entity, activity::Column::MalId),
            (activity::Entity, activity::Column::VolNum),
        ])
        .expr_as(
            Expr::col((activity::Entity, activity::Column::Name)),
            Alias::new("series_name"),
        )
        .expr_as(
            Expr::col((activity::Entity, activity::Column::CountValue)),
            Alias::new("volume_count"),
        )
        .expr_as(
            Expr::col((activity::Entity, activity::Column::CreatedOn)),
            Alias::new("created_at"),
        )
        .from(activity::Entity)
        .inner_join(
            follow::Entity,
            Expr::col((follow::Entity, follow::Column::FollowingId))
                .equals((activity::Entity, activity::Column::UserId)),
        )
        .inner_join(
            user::Entity,
            Expr::col((user::Entity, user::Column::Id))
                .equals((activity::Entity, activity::Column::UserId)),
        )
        .and_where(Expr::col((follow::Entity, follow::Column::FollowerId)).eq(follower_id))
        .and_where(Expr::col((user::Entity, user::Column::PublicSlug)).is_not_null())
        .order_by(
            (activity::Entity, activity::Column::CreatedOn),
            sea_orm::Order::Desc,
        )
        .limit(limit)
        .to_owned();

    let rows: Vec<Row> = Row::find_by_statement(db.get_database_backend().build(&stmt))
        .all(db)
        .await
        .map_err(AppError::from)?;

    Ok(rows
        .into_iter()
        .map(|r| FeedEntry {
            event_id: r.event_id,
            actor_user_id: r.actor_user_id,
            actor_slug: r.actor_slug,
            actor_display_name: r.actor_display_name,
            event_type: r.event_type,
            mal_id: r.mal_id,
            vol_num: r.vol_num,
            series_name: r.series_name,
            volume_count: r.volume_count,
            created_at: r.created_at,
        })
        .collect())
}

/// Convenience: am I following this slug? Used by the public
/// profile page to render the "Follow" / "Following" button state.
pub async fn is_following(
    db: &Db,
    follower_id: i32,
    slug: &str,
) -> Result<bool, AppError> {
    let target = match resolve_slug_to_user(db, slug).await {
        Ok(id) => id,
        Err(AppError::NotFound(_)) => return Ok(false),
        Err(e) => return Err(e),
    };
    let row = FollowEntity::find()
        .filter(follow::Column::FollowerId.eq(follower_id))
        .filter(follow::Column::FollowingId.eq(target))
        .one(db)
        .await
        .map_err(AppError::from)?;
    Ok(row.is_some())
}
