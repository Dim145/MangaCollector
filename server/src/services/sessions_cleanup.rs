//! Raw upstream session-row deletion.
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
//! effectively dead weight, and any FK or DELETE pointing at it was
//! the source of the "no row affected" bug we kept chasing.
//!
//! This helper issues the DELETE against the *real* table. We keep
//! the table identifier in one place so a future migration to a
//! different schema/table only has to update this constant.

const SESSION_TABLE: &str = r#""tower_sessions"."session""#;

/// DELETE the upstream session row for `session_id`. Returns the number
/// of rows affected so the caller can react to "no match" if needed —
/// we ignore the count today because the meta-row check in
/// `services::sessions::revoke` is already authoritative on whether
/// the session was a real one.
pub async fn delete_tower_session(
    db: &sea_orm::DatabaseConnection,
    session_id: &str,
) -> Result<u64, sqlx::Error> {
    use sea_orm::{ConnectionTrait, Statement};
    let stmt = Statement::from_sql_and_values(
        sea_orm::DatabaseBackend::Postgres,
        // SAFE — `SESSION_TABLE` is a fixed `&'static str` literal, no
        // user input is interpolated into the SQL.
        &format!("DELETE FROM {SESSION_TABLE} WHERE id = $1"),
        [session_id.into()],
    );
    let res = db
        .execute(stmt)
        .await
        .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
    Ok(res.rows_affected())
}
