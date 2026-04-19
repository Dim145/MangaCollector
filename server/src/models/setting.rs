use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// SeaORM entity for user settings
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "settings")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub created_on: chrono::DateTime<chrono::Utc>,
    pub modified_on: chrono::DateTime<chrono::Utc>,
    pub user_id: i32,
    pub currency: String,
    #[sea_orm(column_name = "titleType")]
    pub title_type: Option<String>,
    pub adult_content_level: i32,
    pub theme: Option<String>,
    pub language: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

pub type SettingRow = Model;

/// Full currency object returned to clients
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurrencyInfo {
    pub code: String,
    pub symbol: String,
    pub separator: String,
    pub decimal: String,
    pub precision: u8,
    pub format: String,
    #[serde(rename = "negativePattern")]
    pub negative_pattern: String,
}

/// API response shape for settings
#[derive(Debug, Serialize)]
pub struct SettingsResponse {
    pub currency: CurrencyInfo,
    #[serde(rename = "titleType")]
    pub title_type: String,
    pub adult_content_level: i32,
    pub theme: String,
    pub language: String,
    #[serde(rename = "authName")]
    pub auth_name: String,
    #[serde(rename = "authIcon")]
    pub auth_icon: String,
}

/// Request body for updating settings
#[derive(Debug, Deserialize)]
pub struct UpdateSettingsRequest {
    pub currency: Option<String>,
    #[serde(rename = "titleType")]
    pub title_type: Option<String>,
    pub adult_content_level: Option<i32>,
    pub theme: Option<String>,
    pub language: Option<String>,
}
