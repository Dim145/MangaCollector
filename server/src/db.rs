use sea_orm::{DatabaseConnection, SqlxPostgresConnector};
use sqlx::postgres::PgPoolOptions;

/// Raw sqlx pool — kept for the session store (tower-sessions-sqlx-store)
pub type DbPool = sqlx::PgPool;

/// SeaORM connection used by all service/repository code
pub type Db = DatabaseConnection;

pub async fn create_pool(database_url: &str) -> Result<DbPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(10)
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
