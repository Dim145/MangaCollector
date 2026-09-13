//! 預け · One row per loan ever made (see `services::loan_history`).
use sea_orm::entity::prelude::*;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize)]
#[sea_orm(table_name = "loan_history")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub user_id: i32,
    /// The volume while it exists; NULL once deleted or rebuilt by an import.
    pub volume_id: Option<i32>,
    pub mal_id: i32,
    pub vol_num: i32,
    /// Snapshotted at lend time.
    pub series_name: String,
    pub borrower: String,
    pub borrower_user_id: Option<i32>,
    pub borrower_slug: Option<String>,
    pub loaned_at: chrono::DateTime<chrono::Utc>,
    pub due_at: Option<chrono::DateTime<chrono::Utc>>,
    /// NULL while the tome is still out.
    pub returned_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
