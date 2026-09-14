//! 記 · The MCP audit trail.
//!
//! One row per tool call, so the owner of an account can see what an
//! agent did on their behalf and an operator can investigate abuse.
//!
//! Two rules shape it. **Arguments are digested, never stored**: they
//! carry prices, private notes, borrower names and shelf locations, and
//! a digest still answers the question an audit trail is actually asked
//! — "is this the same call again, or a different one?". And **a
//! failure to audit never fails the call**: the write is best-effort and
//! logged on error. Losing a log line is bad; losing the user's edit
//! because we could not log it is worse.

use sea_orm::entity::prelude::*;
use sea_orm::{ActiveValue::Set, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use sha2::{Digest, Sha256};

use crate::db::Db;
use crate::errors::AppError;
use crate::models::mcp_audit::{ActiveModel, AuditEntry, Column, Entity};

/// How a call ended.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// It ran and produced a result.
    Ok,
    /// Refused before running: a scope the key does not carry, or a
    /// destructive tool invoked without `confirm`. Distinct from
    /// `Error` because it is the line a user most wants to see —
    /// "something tried to delete with a read-only key".
    Denied,
    /// It ran and failed.
    Error,
}

impl Outcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Ok => "ok",
            Outcome::Denied => "denied",
            Outcome::Error => "error",
        }
    }
}

/// Digest a tool's arguments for the trail.
///
/// Serialised canonically by `serde_json` (which orders map keys), so
/// the same call digests the same way across processes and restarts —
/// otherwise "the same call again" could not be recognised, which is the
/// one question the digest exists to answer.
pub fn args_digest(args: &serde_json::Value) -> String {
    hex::encode(Sha256::digest(args.to_string().as_bytes()))
}

/// Record one call. Best-effort: errors are logged, never propagated.
#[allow(clippy::too_many_arguments)]
pub async fn record(
    db: &Db,
    user_id: i32,
    api_key_id: &str,
    tool: &str,
    outcome: Outcome,
    duration_ms: Option<i32>,
    args_digest: Option<String>,
    detail: Option<&str>,
) {
    let row = ActiveModel {
        user_id: Set(user_id),
        api_key_id: Set(Some(api_key_id.to_string())),
        at: Set(chrono::Utc::now()),
        tool: Set(tool.to_string()),
        outcome: Set(outcome.as_str().to_string()),
        duration_ms: Set(duration_ms),
        args_digest: Set(args_digest),
        // Bounded: a detail is a short reason, and an upstream error
        // chain that grew without limit would be a slow way to fill a
        // table nobody prunes.
        detail: Set(detail.map(|d| d.chars().take(500).collect())),
        ..Default::default()
    };
    if let Err(err) = Entity::insert(row).exec(db).await {
        tracing::warn!(%err, tool, "mcp_audit: could not record a tool call");
    }
}

/// The caller's own trail, newest first.
pub async fn list(db: &Db, user_id: i32, limit: u64) -> Result<Vec<AuditEntry>, AppError> {
    let rows = Entity::find()
        .filter(Column::UserId.eq(user_id))
        .order_by_desc(Column::At)
        .limit(limit.clamp(1, 500))
        .all(db)
        .await?;
    Ok(rows
        .into_iter()
        .map(|r| AuditEntry {
            at: r.at,
            tool: r.tool,
            outcome: r.outcome,
            duration_ms: r.duration_ms,
            detail: r.detail,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_outcome_has_a_stable_wire_name() {
        // The migration's comment enumerates these three; a rename here
        // would silently split a user's history in two.
        assert_eq!(Outcome::Ok.as_str(), "ok");
        assert_eq!(Outcome::Denied.as_str(), "denied");
        assert_eq!(Outcome::Error.as_str(), "error");
    }

    #[test]
    fn the_digest_is_stable_and_hides_the_arguments() {
        let args = serde_json::json!({ "mal_id": 2, "note": "in the red box" });
        let d = args_digest(&args);
        assert_eq!(d.len(), 64);
        assert_eq!(d, args_digest(&args), "same call must digest the same");
        assert!(!d.contains("red box"));
        assert_ne!(
            d,
            args_digest(&serde_json::json!({ "mal_id": 2, "note": "in the blue box" }))
        );
    }

    #[test]
    fn key_order_does_not_change_the_digest() {
        // `serde_json::Value` maps are ordered, so two spellings of the
        // same object must land on one digest — otherwise "the same call
        // again" stops being recognisable, which is the whole point.
        let a = serde_json::json!({ "a": 1, "b": 2 });
        let b: serde_json::Value = serde_json::from_str(r#"{"b":2,"a":1}"#).unwrap();
        assert_eq!(args_digest(&a), args_digest(&b));
    }
}
