use rust_decimal::Decimal;
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "coffrets")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub user_id: i32,
    pub mal_id: i32,
    pub name: String,
    pub vol_start: i32,
    pub vol_end: i32,
    pub price: Option<Decimal>,
    pub store: Option<String>,
    pub created_on: chrono::DateTime<chrono::Utc>,
    pub modified_on: chrono::DateTime<chrono::Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

pub type Coffret = Model;

/// Per-field length caps for the user-supplied text columns. Mirrors
/// the constants in `models::library` (publisher / edition) — same
/// "let normal use breathe, refuse a megabyte paste" sizing. The
/// frontend `<input maxLength=…>` should match these so a user never
/// gets silently truncated server-side without a UI hint first.
///
///   • COFFRET_NAME_MAX_LEN — frontend input is `maxLength={100}` in
///     [AddCoffretModal](client/src/components/AddCoffretModal.jsx)
///     and [CoffretGroup](client/src/components/CoffretGroup.jsx).
///   • STORE_MAX_LEN — covers both coffret.store and volume.store; the
///     frontend's `<StoreAutocomplete>` defaults to the same cap.
pub const COFFRET_NAME_MAX_LEN: usize = 100;
pub const STORE_MAX_LEN: usize = 80;

/// Request body for creating a new coffret. Server computes per-volume price
/// as `price / (vol_end - vol_start + 1)` and stamps each volume in that
/// range as owned + linked to the new coffret.
#[derive(Debug, Deserialize)]
pub struct CreateCoffretRequest {
    pub name: String,
    pub vol_start: i32,
    pub vol_end: i32,
    pub price: Option<Decimal>,
    pub store: Option<String>,
    #[serde(default)]
    pub collector: bool,
}

/// Request body for updating a coffret's metadata. Only the header fields
/// (name / price / store) are editable — the volume range is fixed at
/// creation time. Per-volume prices stay independent of the coffret total.
/// All three fields are optional with `#[serde(default)]` so the client can
/// send partial patches.
#[derive(Debug, Deserialize)]
pub struct UpdateCoffretRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub price: Option<Decimal>,
    #[serde(default)]
    pub store: Option<String>,
    #[serde(default)]
    pub clear_price: bool,
    #[serde(default)]
    pub clear_store: bool,
}
