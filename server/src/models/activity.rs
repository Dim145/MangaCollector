use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// SeaORM entity for the activity log. Event-driven history of the user's
/// library — used by the Activity Feed on /profile.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "activity_log")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub user_id: i32,
    pub event_type: String,
    pub mal_id: Option<i32>,
    pub vol_num: Option<i32>,
    pub name: Option<String>,
    pub count_value: Option<i32>,
    pub created_on: chrono::DateTime<chrono::Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

pub type Activity = Model;

/// Event types emitted by the system. Must stay in sync with the i18n
/// translations on the frontend (`activity.*` keys).
pub mod event_types {
    pub const SERIES_ADDED: &str = "series_added";
    pub const SERIES_REMOVED: &str = "series_removed";
    pub const SERIES_COMPLETED: &str = "series_completed";
    pub const VOLUME_OWNED: &str = "volume_owned";
    pub const VOLUME_UNOWNED: &str = "volume_unowned";
    pub const MILESTONE_VOLUMES: &str = "milestone_volumes";
    pub const MILESTONE_SERIES: &str = "milestone_series";
}
