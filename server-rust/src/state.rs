use std::sync::Arc;
use std::time::Instant;

use crate::auth::OidcState;
use crate::config::Config;
use crate::db::{Db, DbPool};
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
