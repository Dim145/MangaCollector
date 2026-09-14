//! 記 · SeaORM entity for `mcp_audit_log` — one row per MCP tool call.

use sea_orm::entity::prelude::*;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "mcp_audit_log")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub user_id: i32,
    /// Public id of the key that made the call. Goes `NULL` when the key
    /// is revoked — revoking must not erase what it did.
    pub api_key_id: Option<String>,
    pub at: chrono::DateTime<chrono::Utc>,
    pub tool: String,
    pub outcome: String,
    pub duration_ms: Option<i32>,
    /// SHA-256 of the arguments, never the arguments. They carry prices,
    /// private notes, borrower names and shelf locations, and this table
    /// is read back by the owning user's own UI.
    pub args_digest: Option<String>,
    pub detail: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

/// A row as the settings page shows it.
#[derive(Debug, Serialize)]
pub struct AuditEntry {
    pub at: chrono::DateTime<chrono::Utc>,
    pub tool: String,
    pub outcome: String,
    pub duration_ms: Option<i32>,
    pub detail: Option<String>,
}
