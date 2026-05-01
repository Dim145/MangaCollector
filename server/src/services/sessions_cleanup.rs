//! Raw upstream session-row helpers.
//!
//! tower-sessions-sqlx-store stores its rows in a table the LIBRARY
//! creates at boot, NOT the `tower_sessions` table our project's own
//! migration scaffolds. Default placement (per
//! `tower_sessions_sqlx_store::PostgresStore::new`) is the table
//! named `session` inside the schema `tower_sessions`:
//!
//!     "tower_sessions"."session"
//!         id            text primary key not null,
//!         data          bytea not null,
//!         expiry_date   timestamptz not null
//!
//! Our `migrations/.../sessions.sql` originally created a `public.
//! tower_sessions` table that the library never touches — it's
//! effectively dead weight (now dropped via
//! `20260426160000_drop_legacy_tower_sessions.sql`), and any FK or
//! DELETE pointing at it was the source of the "no row affected" bug
//! we kept chasing.
//!
//! These helpers operate on the *real* table. We keep the table
//! identifier in one place so a future migration to a different
//! schema/table only has to update this constant.

use sea_orm::{ConnectionTrait, DbErr, Statement};

const SESSION_TABLE: &str = r#""tower_sessions"."session""#;

/// DELETE the upstream session row for `session_id`. Returns the
/// number of rows affected so the caller can react to "no match" if
/// needed. The meta-row check in `services::sessions::revoke` is
/// already authoritative on whether the session was a real one, so
/// the count is mostly informational here.
///
/// Returns `DbErr` directly (rather than wrapping into
/// `sqlx::Error::Protocol(...)` as before) so callers can pattern-match
/// on the actual SeaORM error variant — timeout vs constraint vs
/// connection-pool-exhausted are distinct enough to deserve distinct
/// handling, and the previous `Protocol` blob threw all that away.
pub async fn delete_tower_session(
    db: &sea_orm::DatabaseConnection,
    session_id: &str,
) -> Result<u64, DbErr> {
    let stmt = Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        // SAFE — `SESSION_TABLE` is a fixed `&'static str` literal, no
        // user input is interpolated into the SQL.
        format!("DELETE FROM {SESSION_TABLE} WHERE id = $1"),
        [session_id.into()],
    );
    let res = db.execute(stmt).await?;
    Ok(res.rows_affected())
}

/// Check whether a session row exists in `"tower_sessions"."session"`
/// AND has not yet expired. Returns `true` when the cookie still
/// resolves to a live session per the upstream store's bookkeeping.
///
/// 機 · The revocation gate uses this in tandem with the meta-row
/// presence check: meta says "is this session still authorised?",
/// `tower_sessions.expiry_date` says "is the cookie itself still
/// alive?". Either being false revokes the request.
///
/// On DB error we return `false` (fail-closed) — same policy as the
/// meta lookup. The audit's previous fail-open posture was a real
/// bypass under pool pressure.
pub async fn upstream_session_alive(
    db: &sea_orm::DatabaseConnection,
    session_id: &str,
) -> bool {
    let stmt = Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        format!(
            "SELECT 1 FROM {SESSION_TABLE} WHERE id = $1 AND expiry_date > NOW() LIMIT 1"
        ),
        [session_id.into()],
    );
    match db.query_one(stmt).await {
        Ok(Some(_)) => true,
        // No row OR expired row → session is dead.
        Ok(None) => false,
        // DB error → treat as dead. Worst case we 401 a legit user
        // during a transient outage (they re-login); the alternative
        // (fail-open) lets a revoked / expired cookie keep working.
        Err(_) => false,
    }
}
