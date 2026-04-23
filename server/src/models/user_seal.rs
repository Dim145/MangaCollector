use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// SeaORM entity — 印鑑帳 / user_seals
///
/// Composite primary key (user_id, seal_code) enforces one-per-user uniqueness
/// without needing a surrogate id column. `earned_at` is set once on the first
/// grant and never updated.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "user_seals")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub user_id: i32,
    #[sea_orm(primary_key, auto_increment = false)]
    pub seal_code: String,
    pub earned_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

pub type UserSeal = Model;

/// API response shape for the carnet de sceaux.
///
/// Sent as a single GET payload so the client can render the full journal
/// without a second round-trip. The catalog (codes + order) is duplicated
/// client-side for i18n purposes; `earned` is the authoritative truth of
/// what the user has actually unlocked.
#[derive(Debug, Serialize)]
pub struct SealsResponse {
    /// All seals the user has ever earned, oldest first (so the carnet reads
    /// chronologically — oldest sceau on the first page, latest on the last).
    pub earned: Vec<EarnedSeal>,
    /// Seals that were granted **during this request** — the UI plays a
    /// one-time ceremonial stamp animation for each.
    pub newly_granted: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct EarnedSeal {
    pub code: String,
    pub earned_at: chrono::DateTime<chrono::Utc>,
}
