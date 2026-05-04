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
    pub avatar_url: Option<String>,
    pub sound_enabled: bool,
    /// 朱 · User-customisable accent palette name. NULL = default
    /// (hanko / shu). See `VALID_ACCENT_COLORS` in `services/settings.rs`
    /// for the full list. Validated server-side; the column also carries
    /// a CHECK constraint as defence-in-depth.
    pub accent_color: Option<String>,
    /// 棚 · Toggle the 3D "shelf" rendering on Dashboard cards.
    /// Off by default — the flat grid is the canonical layout.
    pub shelf_3d_enabled: bool,
    /// 筆 · Toggle the ink-trail cursor that paints a brush stroke
    /// over headings marked `data-ink-trail`. Off by default — the
    /// effect is decorative and fine-pointer-only; users explicitly
    /// opt in from Settings.
    pub ink_trail_enabled: bool,
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
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
    pub sound_enabled: bool,
    pub accent_color: Option<String>,
    pub shelf_3d_enabled: bool,
    pub ink_trail_enabled: bool,
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
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
    pub sound_enabled: Option<bool>,
    /// 朱 · Accent palette pick. `None` means "leave it" (PATCH
    /// semantics); `Some("")` means "reset to default"; `Some("kin")`
    /// (or any other valid name) sets the new accent.
    pub accent_color: Option<String>,
    /// 棚 · Toggle the 3D shelf view on Dashboard.
    pub shelf_3d_enabled: Option<bool>,
    /// 筆 · Toggle the ink-trail cursor over titles. Off by default
    /// since the effect is opt-in eye-candy that fine-pointer users
    /// may or may not want.
    pub ink_trail_enabled: Option<bool>,
}
