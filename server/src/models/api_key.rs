//! 鍵 · SeaORM entity for `user_api_keys` — the credentials that open
//! the MCP endpoint.

use sea_orm::entity::prelude::*;
use serde::Serialize;

/// A stored key. The secret itself is not in here and cannot be
/// recovered — only the digest of it is.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "user_api_keys")]
pub struct Model {
    /// Public identifier, a UUID string. What the listing shows and what
    /// revocation takes — never the credential.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub user_id: i32,
    /// The public half of `mcp_<prefix>_<secret>`. Indexed unique: it is
    /// how a presented key finds its row, and it is the rate-limit
    /// bucket, so it is safe to log.
    pub prefix: String,
    /// SHA-256 of the secret half, lowercase hex.
    pub secret_hash: String,
    /// What the user called it ("Claude Desktop", "laptop").
    pub label: String,
    /// Comma-separated allow-list. No wildcard; empty grants nothing.
    pub scopes: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_used_at: Option<chrono::DateTime<chrono::Utc>>,
    /// `None` means no expiry.
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

/// What `GET /api/user/api-keys` returns. Deliberately carries no
/// `secret_hash`: a digest is not a credential, but it is also of no use
/// to the page, and shipping it would only invite an offline attack on a
/// key whose secret is short.
#[derive(Debug, Serialize)]
pub struct ApiKeyInfo {
    pub id: String,
    /// `mcp_<prefix>` — enough for the user to recognise which key a
    /// client is using, useless as a credential on its own.
    pub prefix: String,
    pub label: String,
    pub scopes: Vec<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_used_at: Option<chrono::DateTime<chrono::Utc>>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
    /// True once `expires_at` is in the past. Computed server-side so
    /// the page does not have to agree with us about "now".
    pub expired: bool,
}
