//! 鍵 · `/api/user/api-keys` — mint, list and revoke the credentials
//! that open the MCP endpoint.
//!
//! Session-authenticated, like the rest of `/api`: a key is minted from
//! the settings page by a signed-in human. The keys themselves never
//! authenticate here — that happens only on `/mcp`, which accepts no
//! cookie. Keeping the two apart is what stops a stolen key from
//! reaching this route and minting itself a wider one.

use axum::{
    Json,
    extract::{Path, State},
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::models::api_key::ApiKeyInfo;
use crate::models::mcp_audit::AuditEntry;
use crate::services::api_keys::{self, Scope, ScopeSet};
use crate::services::mcp_audit;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct MintRequest {
    pub label: String,
    /// Explicit allow-list. No wildcard is accepted and an empty list is
    /// refused — see `services::api_keys::mint`.
    pub scopes: Vec<String>,
    #[serde(default)]
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// The mint response, and the only time the credential exists outside
/// the caller's client.
#[derive(Debug, Serialize)]
pub struct MintResponse {
    #[serde(flatten)]
    pub key: ApiKeyInfo,
    /// `mcp_<prefix>_<secret>`. Not stored, not recoverable, never sent
    /// again — the page must tell the user so before they close it.
    pub secret: String,
}

/// GET /api/user/api-keys
pub async fn list(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<Vec<ApiKeyInfo>>, AppError> {
    Ok(Json(api_keys::list(&state.db, user.id).await?))
}

/// GET /api/user/api-keys/scopes — the catalogue the mint dialog renders.
///
/// Served rather than hardcoded in the SPA so the two cannot drift: a
/// scope added on the server shows up in the dialog on the next load,
/// and one removed stops being offerable.
///
/// `enabled` rides along so the panel can say "the operator has not
/// turned this on" instead of offering to mint a key that every client
/// would meet with a 403. Authenticated, unlike `/api/public-config`,
/// which is why it is fine to state here whether the endpoint is up.
pub async fn scopes(
    State(state): State<AppState>,
    AuthenticatedUser(_user): AuthenticatedUser,
) -> Json<serde_json::Value> {
    Json(json!({
        "enabled": state.config.mcp.enabled,
        "all": Scope::ALL.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
        "read_only": Scope::READ_ONLY.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
    }))
}

/// POST /api/user/api-keys
pub async fn mint(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(body): Json<MintRequest>,
) -> Result<Json<MintResponse>, AppError> {
    let scopes = ScopeSet::parse_requested(&body.scopes)?;
    let minted = api_keys::mint(&state.db, user.id, &body.label, scopes, body.expires_at).await?;
    Ok(Json(MintResponse {
        key: minted.info,
        secret: minted.secret,
    }))
}

/// DELETE /api/user/api-keys/{id}
///
/// 404 rather than 403 when the id belongs to someone else: the caller
/// is not entitled to learn that it exists.
pub async fn revoke(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    if api_keys::revoke(&state.db, user.id, &id).await? {
        Ok(Json(json!({ "success": true })))
    } else {
        Err(AppError::NotFound("No such API key.".into()))
    }
}

/// Query for `GET /api/user/api-keys/audit`.
#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    pub limit: Option<u64>,
}

/// GET /api/user/api-keys/audit — 記 · what agents did on this account.
///
/// Scoped to the caller, newest first. Arguments appear only as a
/// digest: they carry prices, private notes, borrower names and shelf
/// locations, and this is the user's own screen, not a debugger.
pub async fn audit(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    axum::extract::Query(q): axum::extract::Query<AuditQuery>,
) -> Result<Json<Vec<AuditEntry>>, AppError> {
    Ok(Json(
        mcp_audit::list(&state.db, user.id, q.limit.unwrap_or(100)).await?,
    ))
}
