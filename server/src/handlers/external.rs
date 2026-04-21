use axum::{Json, extract::{Query, State}};
use serde::Deserialize;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::services::external;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
}

/// GET /api/external/search?q=<title>
///
/// Parallel search against MAL (Jikan) and MangaDex, merged by the service.
/// Authenticated: we don't want unauthenticated users hammering two external
/// APIs through us.
pub async fn search(
    State(state): State<AppState>,
    AuthenticatedUser(_user): AuthenticatedUser,
    Query(params): Query<SearchQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let q = params.q.unwrap_or_default();
    let results = external::merged_search(&state.http_client, state.cache.as_deref(), &q).await;
    Ok(Json(serde_json::json!({ "results": results })))
}
