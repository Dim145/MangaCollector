//! 鍵 · Per-user API keys — the credentials that open the MCP endpoint.
//!
//! ## Shape of a key
//!
//! ```text
//!     mcp_a1b2c3d4e5f6_9f8e…  (64 hex)
//!     └┬─┘└─────┬────┘ └──┬──┘
//!   marker   prefix     secret
//! ```
//!
//! The **prefix** is public. It is what the settings page shows so the
//! user can tell one client's key from another's, what the rate limiter
//! buckets on, and the indexed lookup that finds the row — so it is safe
//! to log. The **secret** is stored as a SHA-256 digest and shown to the
//! user exactly once, at mint time. This is the same rule
//! `user_session_meta.public_id` exists for: a credential that the
//! server can hand back is a credential that leaks.
//!
//! ## Why a static key rather than OAuth
//!
//! The MCP specification's authorization profile is OAuth 2.1, and it is
//! a SHOULD for HTTP transports — authorization itself is OPTIONAL. A
//! self-hosted instance with no authorization server in front of it has
//! nothing to run that flow against, and a statically-issued key is the
//! right shape for it. The cost is worth stating plainly: clients that
//! let you set a header work; clients that only do OAuth discovery, such
//! as claude.ai web connectors, do not.

use sea_orm::entity::prelude::*;
use sea_orm::{ActiveValue::Set, QueryOrder};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use crate::db::Db;
use crate::errors::AppError;
use crate::models::api_key::{ActiveModel, ApiKeyInfo, Column, Entity, Model};
use crate::models::user::User;

/// Leading marker on every key this server issues. Lets a client (and a
/// log line, and the rate-limit bucket) recognise one on sight.
pub const TOKEN_MARKER: &str = "mcp_";

/// Hex characters in the public prefix. 48 bits — not a secret, just an
/// identifier, and short enough to read out of a settings page.
const PREFIX_LEN: usize = 12;

/// How stale `last_used_at` is allowed to get before we spend a write on
/// it. Without this every tool call costs an UPDATE, which is a lot of
/// write traffic to answer a question ("when did this key last run?")
/// nobody asks to the minute.
#[allow(
    dead_code,
    reason = "consumed by routes::mcp::guard — see the note above `authenticate`"
)]
const LAST_USED_GRANULARITY_SECS: i64 = 60;

/// The most keys one account may hold at once. Not a security boundary —
/// a bound, so a scripted mint loop cannot grow the table without limit.
const MAX_KEYS_PER_USER: u64 = 20;

// ── Scopes ───────────────────────────────────────────────────────────

/// What a key is allowed to reach.
///
/// There is deliberately no wildcard and no "all" variant: a scope set
/// is an explicit allow-list, and the empty set grants nothing. The MCP
/// security guidance calls this scope minimisation — the point being
/// that `tools/list` can then answer with only the tools a given key can
/// actually call, so a read-only key never sees a delete it would be
/// refused.
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Scope {
    LibraryRead,
    LibraryWrite,
    LibraryDelete,
    VolumesWrite,
    LoansRead,
    LoansWrite,
    LocationsRead,
    LocationsWrite,
    ReleasesRead,
    StatsRead,
    SocialRead,
    IsbnRead,
}

impl Scope {
    /// Every scope, in the order the settings page should list them.
    pub const ALL: &'static [Scope] = &[
        Scope::LibraryRead,
        Scope::LibraryWrite,
        Scope::LibraryDelete,
        Scope::VolumesWrite,
        Scope::LoansRead,
        Scope::LoansWrite,
        Scope::LocationsRead,
        Scope::LocationsWrite,
        Scope::ReleasesRead,
        Scope::StatsRead,
        Scope::SocialRead,
        Scope::IsbnRead,
    ];

    /// The read-only preset the mint dialog opens on. Widening is a
    /// deliberate act; starting wide and narrowing is one people forget.
    pub const READ_ONLY: &'static [Scope] = &[
        Scope::LibraryRead,
        Scope::LoansRead,
        Scope::LocationsRead,
        Scope::ReleasesRead,
        Scope::StatsRead,
        Scope::SocialRead,
        Scope::IsbnRead,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Scope::LibraryRead => "library:read",
            Scope::LibraryWrite => "library:write",
            Scope::LibraryDelete => "library:delete",
            Scope::VolumesWrite => "volumes:write",
            Scope::LoansRead => "loans:read",
            Scope::LoansWrite => "loans:write",
            Scope::LocationsRead => "locations:read",
            Scope::LocationsWrite => "locations:write",
            Scope::ReleasesRead => "releases:read",
            Scope::StatsRead => "stats:read",
            Scope::SocialRead => "social:read",
            Scope::IsbnRead => "isbn:read",
        }
    }

    pub fn parse(raw: &str) -> Option<Scope> {
        Scope::ALL.iter().copied().find(|s| s.as_str() == raw)
    }
}

/// A key's allow-list. Sorted and deduplicated on construction so the
/// stored string is canonical and two equal sets compare equal.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ScopeSet(Vec<Scope>);

impl ScopeSet {
    pub fn new(mut scopes: Vec<Scope>) -> Self {
        scopes.sort_unstable();
        scopes.dedup();
        Self(scopes)
    }

    /// Parse the stored comma-separated form. Unknown entries are
    /// dropped rather than failing the whole row: a key minted by a
    /// newer build that names a scope this one has never heard of should
    /// lose that one capability, not stop authenticating.
    pub fn parse_stored(raw: &str) -> Self {
        Self::new(
            raw.split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .filter_map(Scope::parse)
                .collect(),
        )
    }

    /// Parse a set supplied by the user at mint time. Unknown entries
    /// are an error here — silently dropping a scope someone asked for
    /// would mint a key that does less than its owner believes.
    pub fn parse_requested(raw: &[String]) -> Result<Self, AppError> {
        let mut out = Vec::with_capacity(raw.len());
        for entry in raw {
            let entry = entry.trim();
            if entry.is_empty() {
                continue;
            }
            let scope = Scope::parse(entry)
                .ok_or_else(|| AppError::BadRequest(format!("Unknown scope \"{entry}\".")))?;
            out.push(scope);
        }
        Ok(Self::new(out))
    }

    #[allow(
        dead_code,
        reason = "consumed by routes::mcp::guard — see the note above `authenticate`"
    )]
    pub fn contains(&self, scope: Scope) -> bool {
        self.0.contains(&scope)
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn to_strings(&self) -> Vec<String> {
        self.0.iter().map(|s| s.as_str().to_string()).collect()
    }

    fn to_stored(&self) -> String {
        self.to_strings().join(",")
    }
}

// ── Principal ────────────────────────────────────────────────────────

/// Who is calling, once a presented key has been resolved. Handed down
/// to the MCP tool handlers through the request extensions.
#[derive(Clone, Debug)]
#[allow(
    dead_code,
    reason = "consumed by routes::mcp::guard — see the note above `authenticate`"
)]
pub struct ApiKeyPrincipal {
    pub user: User,
    /// Public id of the key, for the audit log. Never the secret.
    pub key_id: String,
    /// Public prefix, for log lines and the rate-limit bucket.
    pub prefix: String,
    pub scopes: ScopeSet,
}

#[allow(
    dead_code,
    reason = "consumed by routes::mcp::guard — see the note above `authenticate`"
)]
impl ApiKeyPrincipal {
    /// Gate an operation. Returns the spec's `insufficient_scope`
    /// shape rather than a bare 403 so a client can tell "you need a
    /// different key" from "that failed".
    pub fn require(&self, scope: Scope) -> Result<(), AppError> {
        if self.scopes.contains(scope) {
            Ok(())
        } else {
            Err(AppError::Forbidden(format!(
                "This key is missing the \"{}\" scope.",
                scope.as_str()
            )))
        }
    }
}

// ── Minting ──────────────────────────────────────────────────────────

/// A freshly-minted key. `secret` is the only time the full credential
/// exists outside the caller's client — it is not stored and cannot be
/// recovered.
pub struct MintedKey {
    pub info: ApiKeyInfo,
    pub secret: String,
}

fn digest(secret: &str) -> String {
    hex::encode(Sha256::digest(secret.as_bytes()))
}

/// 128 hex characters of CSPRNG output, as two v4 UUIDs. `uuid` is
/// already a dependency and draws from the OS; pulling `rand` in to
/// produce the same bytes would add a crate to audit for nothing.
fn random_hex() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// Mint a key for `user_id` and return it, once.
pub async fn mint(
    db: &Db,
    user_id: i32,
    label: &str,
    scopes: ScopeSet,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<MintedKey, AppError> {
    let label = label.trim();
    if label.is_empty() {
        return Err(AppError::BadRequest("A key needs a label.".into()));
    }
    if label.chars().count() > 60 {
        return Err(AppError::BadRequest(
            "Label is too long (max 60 characters).".into(),
        ));
    }
    // An empty set would mint a credential that authenticates and can do
    // nothing — indistinguishable, from the client's side, from a broken
    // server. Refuse it at the door.
    if scopes.is_empty() {
        return Err(AppError::BadRequest(
            "A key needs at least one scope.".into(),
        ));
    }
    if let Some(at) = expires_at
        && at <= chrono::Utc::now()
    {
        return Err(AppError::BadRequest("Expiry must be in the future.".into()));
    }

    let held = Entity::find()
        .filter(Column::UserId.eq(user_id))
        .count(db)
        .await?;
    if held >= MAX_KEYS_PER_USER {
        return Err(AppError::BadRequest(format!(
            "You already hold {MAX_KEYS_PER_USER} keys — revoke one first."
        )));
    }

    let prefix: String = random_hex().chars().take(PREFIX_LEN).collect();
    let secret = random_hex();
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now();

    let row = ActiveModel {
        id: Set(id),
        user_id: Set(user_id),
        prefix: Set(prefix.clone()),
        secret_hash: Set(digest(&secret)),
        label: Set(label.to_string()),
        scopes: Set(scopes.to_stored()),
        created_at: Set(now),
        last_used_at: Set(None),
        expires_at: Set(expires_at),
    }
    .insert(db)
    .await?;

    Ok(MintedKey {
        info: to_info(row, now),
        secret: format!("{TOKEN_MARKER}{prefix}_{secret}"),
    })
}

fn to_info(row: Model, now: chrono::DateTime<chrono::Utc>) -> ApiKeyInfo {
    ApiKeyInfo {
        expired: row.expires_at.is_some_and(|at| at <= now),
        scopes: ScopeSet::parse_stored(&row.scopes).to_strings(),
        prefix: format!("{TOKEN_MARKER}{}", row.prefix),
        id: row.id,
        label: row.label,
        created_at: row.created_at,
        last_used_at: row.last_used_at,
        expires_at: row.expires_at,
    }
}

/// Every key the user holds, newest first.
pub async fn list(db: &Db, user_id: i32) -> Result<Vec<ApiKeyInfo>, AppError> {
    let now = chrono::Utc::now();
    let rows = Entity::find()
        .filter(Column::UserId.eq(user_id))
        .order_by_desc(Column::CreatedAt)
        .all(db)
        .await?;
    Ok(rows.into_iter().map(|r| to_info(r, now)).collect())
}

/// Revoke one key. Scoped to `user_id`, so a guessed id from another
/// account resolves to nothing rather than to someone else's key.
/// Returns whether a row went.
pub async fn revoke(db: &Db, user_id: i32, id: &str) -> Result<bool, AppError> {
    let res = Entity::delete_many()
        .filter(Column::Id.eq(id))
        .filter(Column::UserId.eq(user_id))
        .exec(db)
        .await?;
    Ok(res.rows_affected > 0)
}

// ── Authentication ───────────────────────────────────────────────────

/// Split `mcp_<prefix>_<secret>` into its two halves.
///
/// Returns `None` for anything that is not shaped like one of our keys,
/// which the caller turns into the same 401 as a wrong secret: telling a
/// prober that their string was *well-formed but wrong* is a free hint.
#[allow(
    dead_code,
    reason = "consumed by routes::mcp::guard — see the note above `authenticate`"
)]
fn split(presented: &str) -> Option<(&str, &str)> {
    let rest = presented.strip_prefix(TOKEN_MARKER)?;
    let (prefix, secret) = rest.split_once('_')?;
    if prefix.len() != PREFIX_LEN || secret.is_empty() {
        return None;
    }
    Some((prefix, secret))
}

/// Resolve a presented key to its owner.
///
/// Every failure below returns `Unauthorized` and nothing more specific.
/// The one exception is a database error, which is ours and is reported
/// as ours — dressing an outage as a bad credential sends the user off
/// rotating keys that were never the problem.
// The only caller is `routes::mcp::guard`: `/api` authenticates with the
// session cookie and must never accept a key, which is what stops a
// stolen key from reaching the mint route and widening itself.
#[allow(
    dead_code,
    reason = "consumed by routes::mcp::guard — see the note above"
)]
pub async fn authenticate(db: &Db, presented: &str) -> Result<ApiKeyPrincipal, AppError> {
    let Some((prefix, secret)) = split(presented.trim()) else {
        return Err(AppError::Unauthorized);
    };

    let Some(row) = Entity::find()
        .filter(Column::Prefix.eq(prefix))
        .one(db)
        .await?
    else {
        return Err(AppError::Unauthorized);
    };

    let now = chrono::Utc::now();
    if row.expires_at.is_some_and(|at| at <= now) {
        return Err(AppError::Unauthorized);
    }

    // Constant-time: the right-hand side is attacker-supplied, and the
    // comparison is cheap enough that there is no reason to leak a
    // prefix-match length through it.
    let presented_digest = digest(secret);
    if presented_digest
        .as_bytes()
        .ct_eq(row.secret_hash.as_bytes())
        .unwrap_u8()
        != 1
    {
        return Err(AppError::Unauthorized);
    }

    // A key whose owner is gone (account deleted between the FK cascade
    // and this read) is not a server error — it is simply not a valid
    // credential any more.
    let Some(user) = crate::services::users::get_by_id(db, row.user_id).await? else {
        return Err(AppError::Unauthorized);
    };

    // Best-effort, and throttled: a failure here must not fail the call
    // the user actually made.
    let stale = row
        .last_used_at
        .is_none_or(|at| (now - at).num_seconds() >= LAST_USED_GRANULARITY_SECS);
    if stale {
        let touch = ActiveModel {
            id: Set(row.id.clone()),
            last_used_at: Set(Some(now)),
            ..Default::default()
        };
        if let Err(err) = touch.update(db).await {
            tracing::warn!(%err, key_id = %row.id, "api_keys: last_used_at touch failed");
        }
    }

    Ok(ApiKeyPrincipal {
        user,
        key_id: row.id,
        prefix: row.prefix,
        scopes: ScopeSet::parse_stored(&row.scopes),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_scope_round_trips_through_its_wire_name() {
        for scope in Scope::ALL {
            assert_eq!(Scope::parse(scope.as_str()), Some(*scope));
        }
    }

    #[test]
    fn every_scope_name_is_unique() {
        let mut names: Vec<&str> = Scope::ALL.iter().map(|s| s.as_str()).collect();
        let before = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), before, "two scopes share a wire name");
    }

    #[test]
    fn the_read_only_preset_grants_no_writes() {
        for scope in Scope::READ_ONLY {
            let name = scope.as_str();
            assert!(
                name.ends_with(":read"),
                "{name} is in the read-only preset but is not a read scope"
            );
        }
    }

    #[test]
    fn a_stored_set_is_canonical_and_survives_a_round_trip() {
        let set = ScopeSet::new(vec![
            Scope::VolumesWrite,
            Scope::LibraryRead,
            Scope::LibraryRead,
        ]);
        assert_eq!(set.to_stored(), "library:read,volumes:write");
        assert_eq!(ScopeSet::parse_stored(&set.to_stored()), set);
    }

    #[test]
    fn a_scope_from_a_newer_build_is_dropped_not_fatal() {
        // Forward compatibility: a key minted by a build that knows a
        // scope this one does not must still authenticate, minus that
        // one capability.
        let set = ScopeSet::parse_stored("library:read,library:teleport");
        assert!(set.contains(Scope::LibraryRead));
        assert_eq!(set.to_strings(), vec!["library:read"]);
    }

    #[test]
    fn a_requested_scope_that_does_not_exist_is_refused() {
        // The other direction: silently dropping what someone asked for
        // would mint a key that does less than its owner believes.
        let err = ScopeSet::parse_requested(&["library:teleport".to_string()])
            .expect_err("unknown scope should be refused at mint time");
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn an_empty_set_grants_nothing() {
        let set = ScopeSet::parse_stored("");
        assert!(set.is_empty());
        for scope in Scope::ALL {
            assert!(!set.contains(*scope));
        }
    }

    #[test]
    fn only_a_well_formed_key_splits() {
        let prefix = "a".repeat(PREFIX_LEN);
        assert_eq!(
            split(&format!("{TOKEN_MARKER}{prefix}_deadbeef")),
            Some((prefix.as_str(), "deadbeef"))
        );
        // No marker, wrong prefix length, no secret, empty secret.
        assert_eq!(split(&format!("{prefix}_deadbeef")), None);
        assert_eq!(split(&format!("{TOKEN_MARKER}short_deadbeef")), None);
        assert_eq!(split(&format!("{TOKEN_MARKER}{prefix}")), None);
        assert_eq!(split(&format!("{TOKEN_MARKER}{prefix}_")), None);
        assert_eq!(split(""), None);
    }

    #[test]
    fn the_secret_half_carries_real_entropy() {
        // Two v4 UUIDs' worth. If this shrinks, the key stops being a
        // key — so pin the length rather than trusting the helper.
        let secret = random_hex();
        assert_eq!(secret.len(), 64);
        assert!(secret.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(secret, random_hex());
    }

    #[test]
    fn the_digest_is_sha256_hex_and_not_the_secret() {
        let d = digest("mcp_test_secret");
        assert_eq!(d.len(), 64);
        assert!(d.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(d, "mcp_test_secret");
        assert_eq!(d, digest("mcp_test_secret"), "digest must be stable");
        assert_ne!(d, digest("mcp_test_secrez"));
    }
}
