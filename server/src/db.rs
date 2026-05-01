use sea_orm::{DatabaseConnection, SqlxPostgresConnector};
use sqlx::postgres::PgPoolOptions;
use std::time::Duration;

/// Raw sqlx pool — kept for the session store (tower-sessions-sqlx-store)
pub type DbPool = sqlx::PgPool;

/// SeaORM connection used by all service/repository code
pub type Db = DatabaseConnection;

pub async fn create_pool(database_url: &str) -> Result<DbPool, sqlx::Error> {
    // Pool sizing rationale:
    //   • `max_connections(20)` — comfortable for a single backend
    //     replica handling REST + WebSocket traffic. The default of
    //     10 was on the low side once long-lived WS clients started
    //     parking connections during their idle reads.
    //   • `acquire_timeout(5s)` — fail fast on pool exhaustion.
    //     sqlx's default is 30 s, which feels like a server hang to
    //     the user and stacks up 503s if the pool is genuinely
    //     undersized. 5 s gives a stalled query enough room to
    //     resolve while keeping perceived latency bounded.
    //   • `idle_timeout(10min)` — recycle idle connections so a long
    //     quiet period doesn't pin all 20 slots until the next
    //     request.
    //   • `max_lifetime(30min)` — defence against driver-side state
    //     drift (server-side cursor leaks, prepared-statement cache
    //     bloat) that would surface as gradually-increasing latency.
    PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(Some(Duration::from_secs(60 * 10)))
        .max_lifetime(Some(Duration::from_secs(60 * 30)))
        .connect(database_url)
        .await
}

/// Wrap the sqlx pool in a SeaORM connection (zero-cost — shares the same pool)
pub fn create_db(pool: DbPool) -> Db {
    SqlxPostgresConnector::from_sqlx_postgres_pool(pool)
}

pub async fn run_migrations(pool: &DbPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}
