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
    pub created_on: chrono::DateTime<chrono::Utc>,
    pub modified_on: chrono::DateTime<chrono::Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
