use std::sync::Arc;
use std::time::Instant;

use crate::auth::OidcState;
use crate::config::Config;
use crate::db::{Db, DbPool};
use crate::observability::FrontendObservabilityConfig;
use crate::services::activity_coalescer::ActivityCoalescer;
use crate::services::cache::CacheStore;
use crate::services::realtime::SyncBroker;
use crate::storage::StorageBackend;

#[derive(Clone)]
pub struct AppState {
    /// SeaORM connection — used by all service code
    pub db: Db,
    /// Raw sqlx pool — used only by the session store
    pub pool: DbPool,
    pub config: Arc<Config>,
    pub storage: Arc<dyn StorageBackend>,
    pub oidc_client: Arc<OidcState>,
    pub http_client: reqwest::Client,
    /// Optional Redis-backed cache (disabled when REDIS_URL is not set).
    /// Services take `Option<&CacheStore>` and no-op when absent.
    pub cache: Option<Arc<CacheStore>>,
    /// Realtime sync broker — fans out invalidation events to every
    /// open WebSocket so mutations propagate between the user's
    /// devices. Always present; Redis is an optional scale-out
    /// backend under the hood.
    pub broker: SyncBroker,
    /// Activity-feed coalescing buffer. Toggleable events
    /// (`volume_owned` ↔ `volume_unowned`, `series_added` ↔
    /// `series_removed`) wait a few seconds before persisting so a
    /// rapid undo cancels the pair instead of polluting the feed.
    /// Other event types route through it transparently and flush
    /// immediately.
    pub activity: ActivityCoalescer,
    /// Snapshot of the FRONTEND_* env vars resolved at boot. Served
    /// verbatim by `GET /api/public-config` so the SPA can wire its
    /// SDKs at runtime without rebuilding the bundle. Wrapped in `Arc`
    /// because every request handler clones `AppState` and we don't
    /// want to clone the inner strings on every fetch.
    pub frontend_config: Arc<FrontendObservabilityConfig>,
    pub start_time: Instant,
}

// Allow axum to extract DbPool directly from AppState (used by tower-sessions)
impl axum::extract::FromRef<AppState> for DbPool {
    fn from_ref(state: &AppState) -> Self {
        state.pool.clone()
    }
}

// Allow axum to extract Db (SeaORM) directly from AppState (used by AuthenticatedUser extractor)
impl axum::extract::FromRef<AppState> for Db {
    fn from_ref(state: &AppState) -> Self {
        state.db.clone()
    }
}
