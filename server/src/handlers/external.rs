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
///
/// 配 · Returns 502 Bad Gateway when BOTH upstream providers fail, so the
/// scan flow client-side can distinguish a transient outage (route through
/// `transient` retry UI) from a legitimate "no results" (route through
/// `not-found` modal). Previously every outcome was 200 with possibly-empty
/// `results`, which made a MAL+MangaDex double-outage look exactly like
/// "this book isn't indexed" — confusing users who saw the scanner reopen
/// silently after a failed lookup.
pub async fn search(
    State(state): State<AppState>,
    AuthenticatedUser(_user): AuthenticatedUser,
    Query(params): Query<SearchQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let q = params.q.unwrap_or_default();
    let outcome = external::merged_search(&state.http_client, state.cache.as_deref(), &q).await;
    if outcome.degraded {
        return Err(AppError::UpstreamUnavailable(
            "Both MAL and MangaDex are unreachable".to_string(),
        ));
    }
    Ok(Json(serde_json::json!({ "results": outcome.results })))
}
