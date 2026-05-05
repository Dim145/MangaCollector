//! 友 Tomo · Follow relationship model.
//!
//! Composite-PK row: `(follower_id, following_id)`. SeaORM requires
//! every entity to have a PK; the composite shape is supported via
//! `#[sea_orm(primary_key, auto_increment = false)]` on each leg.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "user_follows")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub follower_id: i32,
    #[sea_orm(primary_key, auto_increment = false)]
    pub following_id: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

/// API response shape for "users I follow". Joins follow row with
/// the followed user's display info so the frontend can render a
/// rich list without a second query per row.
#[derive(Debug, Clone, Serialize)]
pub struct FollowedUser {
    pub user_id: i32,
    pub public_slug: String,
    pub display_name: Option<String>,
    pub followed_at: chrono::DateTime<chrono::Utc>,
}

/// 重 · A series the requesting user owns AND at least one followed
/// user also owns — used to pick out the "most-shared" series in
/// the social graph. `friend_count` is the number of distinct
/// followed users who own it.
#[derive(Debug, Clone, Serialize)]
pub struct SharedSeries {
    pub mal_id: i32,
    pub name: String,
    pub image_url: Option<String>,
    pub friend_count: i64,
}

/// 推 · A series several followed users have BUT the requesting
/// user doesn't — surfaced as a "what your friends love that you
/// haven't discovered" recommendation. Picked from the long tail
/// where `friend_count` is largest.
#[derive(Debug, Clone, Serialize)]
pub struct LatentRecommendation {
    pub mal_id: i32,
    pub name: String,
    pub image_url: Option<String>,
    pub friend_count: i64,
}

/// Aggregate response of `GET /api/user/follows/overlap`. Both
/// rails share the underlying join — pulling them in a single
/// payload keeps the SPA from making two near-identical fetches
/// when the StatsPage's Tomo section mounts.
#[derive(Debug, Clone, Serialize)]
pub struct OverlapResponse {
    /// Sorted by `friend_count` desc, capped server-side. Top
    /// entry powers the "série la plus partagée" hero card.
    pub shared: Vec<SharedSeries>,
    /// Sorted by `friend_count` desc, capped server-side. Top
    /// few entries power the "recommandations latentes" rail.
    pub latent: Vec<LatentRecommendation>,
    /// Total number of followed users that contributed to the
    /// counts. UI uses it to render "5 amis sur 12 ont ce tome".
    pub friend_total: i64,
}

/// Aggregate activity feed entry — one event from a followed user.
/// Mirrors the activity_log shape but adds the actor's display info
/// so the SPA can render "X added Naruto" without re-resolving.
#[derive(Debug, Clone, Serialize)]
pub struct FeedEntry {
    pub event_id: i32,
    pub actor_user_id: i32,
    pub actor_slug: String,
    pub actor_display_name: Option<String>,
    pub event_type: String,
    pub mal_id: Option<i32>,
    pub vol_num: Option<i32>,
    pub series_name: Option<String>,
    pub volume_count: Option<i32>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}
