//! 棚 · A place where tomes live — a shelf, a box, a room — as a registry
//! row. Tomes point at it by name (see `services::locations`).
use sea_orm::entity::prelude::*;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize)]
#[sea_orm(table_name = "locations")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub user_id: i32,
    /// Exactly the string stored on `user_volumes.location`.
    pub name: String,
    pub note: Option<String>,
    /// Display order, 0-based; ties break on name.
    pub position: i32,
    /// 写 · When the shelf photo was last uploaded — `None` means there
    /// is none. The bytes live in the storage backend; this timestamp
    /// is both the existence flag and the URL's cache-buster.
    pub photo_updated_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_on: chrono::DateTime<chrono::Utc>,
    pub modified_on: chrono::DateTime<chrono::Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
