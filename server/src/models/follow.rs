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
