mod auth;
mod config;
mod db;
mod errors;
mod handlers;
mod models;
mod routes;
mod services;
mod state;
mod storage;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use axum::Router;
use http::HeaderValue;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tower_sessions::cookie::time::Duration;
use tower_sessions::cookie::SameSite;
use tower_sessions::{Expiry, SessionManagerLayer};
use tower_sessions_sqlx_store::PostgresStore;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use crate::config::StorageConfig;
use crate::state::AppState;
use crate::storage::{LocalStorage, S3Storage, StorageBackend};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialise tracing
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Load configuration
    let config = config::Config::from_env()?;
    let port = config.port;
    let frontend_url = config.frontend_url.clone();

    // Database: create sqlx pool, run migrations, then wrap in SeaORM connection
    let pool = db::create_pool(&config.postgres_url).await?;
    db::run_migrations(&pool).await?;
    let orm_db = db::create_db(pool.clone());

    // Storage backend
    let storage: Arc<dyn StorageBackend> = match &config.storage {
        StorageConfig::S3 { .. } => Arc::new(S3Storage::new(&config.storage)),
        StorageConfig::Local { dir } => Arc::new(LocalStorage::new(dir.clone())),
    };

    // OIDC client (performs discovery HTTP call at startup)
    let oidc_client = auth::build_oidc_client(&config).await?;

    // HTTP client for outbound requests (MAL API, OIDC)
    let http_client = reqwest::Client::new();

    // Session store backed by PostgreSQL (uses raw sqlx pool)
    let session_store = PostgresStore::new(pool.clone());
    session_store.migrate().await?;

    let session_layer = SessionManagerLayer::new(session_store)
        .with_secure(false)
        .with_http_only(false)
        .with_same_site(SameSite::Lax)
        .with_expiry(Expiry::OnInactivity(Duration::days(30)));

    // Application state
    let state = AppState {
        db: orm_db,
        pool,
        config: Arc::new(config),
        storage,
        oidc_client: Arc::new(oidc_client),
        http_client,
        start_time: Instant::now(),
    };

    // CORS
    let origin: HeaderValue = frontend_url
        .parse()
        .expect("FRONTEND_URL must be a valid header value");

    let cors = CorsLayer::new()
        .allow_origin(origin)
        .allow_methods(Any)
        .allow_headers(Any);

    // Router
    let app = Router::new()
        .nest("/auth", routes::auth::auth_router())
        .nest("/api", routes::api::api_router())
        .with_state(state)
        .layer(session_layer)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Server running on port {}", port);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}
