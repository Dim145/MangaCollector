use sea_orm::entity::prelude::*;
use serde::Serialize;

/// SeaORM entity for `user_session_meta`. Carries the per-session
/// bookkeeping (`user_id`, optional user-agent string, timestamps)
/// that lives alongside `tower_sessions` rows.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "user_session_meta")]
pub struct Model {
    /// Same id as `tower_sessions.id` — both wear it as their primary
    /// key. The FK with ON DELETE CASCADE is encoded in the migration.
    #[sea_orm(primary_key, auto_increment = false)]
    pub session_id: String,
    pub user_id: i32,
    pub user_agent: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_seen_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

/// Public DTO returned by `GET /api/user/sessions`.
///
/// `is_current` lets the SPA highlight the user's own row and discourage
/// (or specially-handle) revoking it. We don't expose the raw session
/// id externally — `id` is opaque to the client and only used as the
/// argument for the revoke endpoint.
#[derive(Debug, Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_seen_at: chrono::DateTime<chrono::Utc>,
    pub user_agent: Option<String>,
    /// Best-effort device label derived server-side from the UA.
    /// Empty string when the UA is missing or unparseable.
    pub device_label: String,
    /// `true` when this row matches the session that issued the request.
    pub is_current: bool,
}
