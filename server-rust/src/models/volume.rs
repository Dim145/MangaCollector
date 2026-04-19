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
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

pub type Volume = Model;

/// Request body for updating a volume
#[derive(Debug, Deserialize)]
pub struct UpdateVolumeRequest {
    pub id: i32,
    pub owned: bool,
    pub price: Option<Decimal>,
    pub store: Option<String>,
}
