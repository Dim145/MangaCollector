use rust_decimal::Decimal;
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "user_volumes")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub created_on: chrono::DateTime<chrono::Utc>,
    pub modified_on: chrono::DateTime<chrono::Utc>,
    pub user_id: i32,
    pub mal_id: Option<i32>,
    pub vol_num: i32,
    pub owned: bool,
    pub price: Option<Decimal>,
    pub store: Option<String>,
    #[sea_orm(default)]
    pub collector: bool,
    #[sea_orm(default)]
    pub coffret_id: Option<i32>,
    /// First-read timestamp — NULL means unread (tsundoku if `owned`).
    /// Orthogonal to `owned`: a volume can be read without being owned
    /// (borrowed copy) or owned without being read (classic tsundoku).
    #[sea_orm(default)]
    pub read_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

pub type Volume = Model;

/// Request body for updating a volume.
///
/// `read` is sent by the client as a plain boolean — the server maps it
/// to a timestamp (now) on the way in and exposes `read_at` on the way
/// out. Keeping the API boolean means clients don't need to reason about
/// the exact moment the mark was made.
#[derive(Debug, Deserialize)]
pub struct UpdateVolumeRequest {
    pub id: i32,
    pub owned: bool,
    pub price: Option<Decimal>,
    pub store: Option<String>,
    #[serde(default)]
    pub collector: bool,
    /// Reading status — `Some(true)` marks read (stamps read_at=now if
    /// not already set), `Some(false)` clears the timestamp, `None`
    /// leaves the field untouched. Defaults to None for partial updates.
    #[serde(default)]
    pub read: Option<bool>,
}
