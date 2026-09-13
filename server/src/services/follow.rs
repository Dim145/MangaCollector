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
use crate::models::follow::{
    self, ActiveModel, Entity as FollowEntity, FeedEntry, FollowedUser, LatentRecommendation,
    OverlapResponse, SharedSeries,
};
use crate::models::library::{self as library_mod, Entity as LibraryEntity};
use crate::models::user::{self, Entity as UserEntity};
use crate::services::genres::is_adult as is_adult_genres;

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
    // 公開 · The visibility gate below runs in Rust (the adult test reads
    // genre strings, which SQL can't do), so it prunes rows the LIMIT has
    // already picked. Over-fetch so a feed full of hidden series still
    // fills a page; the cap keeps the worst case bounded.
    let fetch = (limit * 4).min(FEED_LIMIT_MAX * 4);

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
        actor_show_adult: bool,
        actor_wishlist_until: Option<chrono::DateTime<chrono::Utc>>,
        entry_genres: Option<String>,
        entry_volumes_owned: Option<i32>,
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
        .expr_as(
            Expr::col((user::Entity, user::Column::PublicShowAdult)),
            Alias::new("actor_show_adult"),
        )
        .expr_as(
            Expr::col((user::Entity, user::Column::WishlistPublicUntil)),
            Alias::new("actor_wishlist_until"),
        )
        .expr_as(
            Expr::col((library_mod::Entity, library_mod::Column::Genres)),
            Alias::new("entry_genres"),
        )
        .expr_as(
            Expr::col((library_mod::Entity, library_mod::Column::VolumesOwned)),
            Alias::new("entry_volumes_owned"),
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
        // The series the event is about, in the ACTOR's library — that
        // is where its genres and owned count live, and both decide
        // whether this event may be shown at all. LEFT so an event with
        // no series (or one the actor has since deleted) still arrives
        // and is judged on its own below.
        .join(
            sea_orm::JoinType::LeftJoin,
            library_mod::Entity,
            Expr::col((library_mod::Entity, library_mod::Column::UserId))
                .equals((activity::Entity, activity::Column::UserId))
                .and(
                    Expr::col((library_mod::Entity, library_mod::Column::MalId))
                        .equals((activity::Entity, activity::Column::MalId)),
                ),
        )
        .and_where(Expr::col((follow::Entity, follow::Column::FollowerId)).eq(follower_id))
        .and_where(Expr::col((user::Entity, user::Column::PublicSlug)).is_not_null())
        .order_by(
            (activity::Entity, activity::Column::CreatedOn),
            sea_orm::Order::Desc,
        )
        .limit(fetch)
        .to_owned();

    let rows: Vec<Row> = Row::find_by_statement(db.get_database_backend().build(&stmt))
        .all(db)
        .await
        .map_err(AppError::from)?;

    let now = chrono::Utc::now();
    Ok(rows
        .into_iter()
        // An event about a series the actor keeps off their public
        // surface stays off their followers' feeds too: the adult
        // opt-out and the Birthday-mode wishlist horizon, the same two
        // gates `build_public_profile` applies. An event whose series
        // isn't in their library any more has nothing left to hide.
        .filter(|r| {
            let Some(owned) = r.entry_volumes_owned else {
                return true;
            };
            let genres: Vec<String> = r
                .entry_genres
                .as_deref()
                .map(|g| {
                    g.split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default();
            crate::services::users::row_publicly_visible(
                &crate::services::users::OwnerVisibility {
                    show_adult: r.actor_show_adult,
                    wishlist_until: r.actor_wishlist_until,
                },
                &genres,
                owned,
                now,
            )
        })
        .take(limit as usize)
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

/// Bounds applied server-side. The lists serve a UI rail, no need
/// for unbounded payloads.
const SHARED_LIMIT: usize = 8;
const LATENT_LIMIT: usize = 12;

/// Compute the social-graph overlap for `user_id`.
///
/// Walks every series in every followed user's library. For each
/// distinct mal_id we count how many followed users own it; the
/// requesting user's library splits the result in two:
///
///   - `shared` — series the user owns AND ≥1 friend owns.
///   - `latent` — series the user does NOT own AND ≥1 friend
///     owns. Recommendations.
///
/// Adult-tagged series (per `services::genres::is_adult`) are
/// dropped from `latent` regardless of any individual viewing
/// preference — the recommendation rail is a discovery surface,
/// not a lifted privacy gate. They stay in `shared` because the
/// user already owns them, no surprise.
pub async fn compute_overlap(db: &Db, user_id: i32) -> Result<OverlapResponse, AppError> {
    use std::collections::HashMap;

    // Step 1 — followed user_ids, gated on `public_slug IS NOT
    // NULL` so a friend who flipped private mid-stream stops
    // contributing without us cascade-deleting the row. SeaORM
    // doesn't have a `Related` impl between Follow ↔ User in
    // this project, so we use an explicit `Query::select()` join
    // with an `Alias` projection — same pattern as
    // `list_following` above.
    use sea_orm::FromQueryResult;
    #[derive(FromQueryResult)]
    struct FollowingId {
        user_id: i32,
    }
    let stmt = Query::select()
        .expr_as(
            Expr::col((follow::Entity, follow::Column::FollowingId)),
            Alias::new("user_id"),
        )
        .from(follow::Entity)
        .inner_join(
            user::Entity,
            Expr::col((user::Entity, user::Column::Id))
                .equals((follow::Entity, follow::Column::FollowingId)),
        )
        .and_where(Expr::col((follow::Entity, follow::Column::FollowerId)).eq(user_id))
        .and_where(Expr::col((user::Entity, user::Column::PublicSlug)).is_not_null())
        .to_owned();
    let following: Vec<i32> = FollowingId::find_by_statement(db.get_database_backend().build(&stmt))
        .all(db)
        .await
        .map_err(AppError::from)?
        .into_iter()
        .map(|r| r.user_id)
        .collect();
    let friend_total = following.len() as i64;
    if following.is_empty() {
        return Ok(OverlapResponse {
            shared: Vec::new(),
            latent: Vec::new(),
            friend_total: 0,
        });
    }

    // Step 2 — friend libraries. One query, collected into a
    // (mal_id → (count, name, image_url, genres)) map.
    let friend_rows = LibraryEntity::find()
        .filter(library_mod::Column::UserId.is_in(following.clone()))
        .filter(library_mod::Column::MalId.is_not_null())
        .all(db)
        .await
        .map_err(AppError::from)?;

    // 公開 · The owners, keyed by id. A followed user's library is NOT
    // wholesale public: the adult opt-out and the Birthday-mode wishlist
    // horizon apply here exactly as they do on their profile page. This
    // rail used to read the rows raw, which meant a friend's `shared`
    // count confirmed they own a series they had opted out of showing,
    // and their wishlist — the whole point of the horizon — was visible
    // year-round to anyone following them.
    let owners: HashMap<i32, crate::models::user::Model> = UserEntity::find()
        .filter(user::Column::Id.is_in(following.clone()))
        .all(db)
        .await
        .map_err(AppError::from)?
        .into_iter()
        .map(|u| (u.id, u))
        .collect();
    let now = chrono::Utc::now();

    type Bucket = (i64, String, Option<String>, Vec<String>);
    let mut tally: HashMap<i32, Bucket> = HashMap::new();
    for row in &friend_rows {
        let Some(mal_id) = row.mal_id else { continue };
        // Negative mal_ids are per-user custom entries — they
        // can't meaningfully overlap across users (each user has
        // their own namespace), so we skip them.
        if mal_id < 0 {
            continue;
        }
        let genres: Vec<String> = row
            .genres
            .as_deref()
            .map(|s| {
                s.split(',')
                    .map(|g| g.trim().to_string())
                    .filter(|g| !g.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        let Some(owner) = owners.get(&row.user_id) else {
            continue;
        };
        if !crate::services::users::row_publicly_visible(
            &owner.into(),
            &genres,
            row.volumes_owned,
            now,
        ) {
            continue;
        }
        let entry = tally.entry(mal_id).or_insert_with(|| {
            (
                0,
                row.name.clone(),
                row.image_url_jpg.clone(),
                genres.clone(),
            )
        });
        entry.0 += 1;
        // Keep the first non-empty image_url we see — bookkeeping
        // detail, the rail just needs *a* cover.
        if entry.2.is_none() && row.image_url_jpg.is_some() {
            entry.2 = row.image_url_jpg.clone();
        }
    }

    // Step 3 — the requesting user's library, just the mal_ids
    // (don't need the rows themselves, just set membership).
    let mine: std::collections::HashSet<i32> = LibraryEntity::find()
        .filter(library_mod::Column::UserId.eq(user_id))
        .filter(library_mod::Column::MalId.is_not_null())
        .all(db)
        .await
        .map_err(AppError::from)?
        .into_iter()
        .filter_map(|r| r.mal_id)
        .collect();

    // Step 4 — split + sort.
    let mut shared = Vec::with_capacity(tally.len());
    let mut latent = Vec::with_capacity(tally.len());
    for (mal_id, (count, name, image_url, genres)) in tally {
        if mine.contains(&mal_id) {
            shared.push(SharedSeries {
                mal_id,
                name,
                image_url,
                friend_count: count,
            });
        } else {
            // Adult content guard — recommendations cross the
            // social graph boundary; respect the discovery-
            // surface policy regardless of viewer setting.
            if is_adult_genres(&genres) {
                continue;
            }
            latent.push(LatentRecommendation {
                mal_id,
                name,
                image_url,
                friend_count: count,
            });
        }
    }
    shared.sort_by(|a, b| b.friend_count.cmp(&a.friend_count).then(a.name.cmp(&b.name)));
    latent.sort_by(|a, b| b.friend_count.cmp(&a.friend_count).then(a.name.cmp(&b.name)));
    shared.truncate(SHARED_LIMIT);
    latent.truncate(LATENT_LIMIT);

    Ok(OverlapResponse {
        shared,
        latent,
        friend_total,
    })
}
