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
use crate::services::cache::CacheStore;
use crate::state::AppState;
use crate::storage::{LocalStorage, S3Storage, StorageBackend};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Health-check subcommand: loopback HTTP call to /api/health, exit 0 on
    // success and 1 on failure. Invoked by the Docker HEALTHCHECK so the
    // scratch-based image doesn't need curl/wget.
    if std::env::args().any(|a| a == "--health") {
        std::process::exit(run_health_check().await);
    }

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

    // Redis cache (optional). Connection failure is logged but doesn't abort
    // startup — services degrade to direct-API mode when the cache is absent.
    let cache: Option<Arc<CacheStore>> = match config.redis_url.as_deref() {
        Some(url) => match CacheStore::connect(url, config.cache_prefix.clone()) {
            Ok(store) => match store.ping().await {
                Ok(()) => {
                    tracing::info!(
                        prefix = %config.cache_prefix,
                        "Cache enabled (Redis reachable)"
                    );
                    Some(Arc::new(store))
                }
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        "Cache disabled: Redis PING failed. Will degrade to direct API calls."
                    );
                    None
                }
            },
            Err(e) => {
                tracing::warn!(error = %e, "Cache disabled: invalid REDIS_URL");
                None
            }
        },
        None => {
            tracing::info!("Cache disabled: REDIS_URL not set");
            None
        }
    };

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
        cache,
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

/// Loopback healthcheck used by `--health`. Hits the running server's
/// `/api/health` endpoint over 127.0.0.1 and mirrors its pass/fail signal as
/// a process exit code.
async fn run_health_check() -> i32 {
    let port = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(3000);
    let url = format!("http://127.0.0.1:{}/api/health", port);

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(_) => return 1,
    };

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => 0,
        _ => 1,
    }
}
