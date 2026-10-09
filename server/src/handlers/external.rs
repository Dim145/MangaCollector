use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::services::{external, mal_api};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
}

/// GET /api/external/search?q=<title>
///
/// Parallel search against MyAnimeList (the official API or Jikan, see
/// `services::mal_api`) and MangaDex, merged by the service.
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

/// GET /api/external/mal/{mal_id}
///
/// 源 · One manga's MyAnimeList details, in Jikan's shape — what the
/// recommendation sheet used to fetch from Jikan in the browser. From
/// the server, the operator's choice of upstream applies
/// (`JIKAN_API_URL`, `MAL_CLIENT_ID`) and the reader's address stays
/// with us. Authenticated, like the search: not an open proxy.
pub async fn mal_manga(
    State(state): State<AppState>,
    AuthenticatedUser(_user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<mal_api::MalMangaData>, AppError> {
    if mal_id <= 0 {
        return Err(AppError::NotFound("No such manga on MyAnimeList".into()));
    }
    match mal_api::get_manga_from_mal(&state.http_client, state.cache.as_deref(), mal_id).await {
        Ok(Some(data)) => Ok(Json(data)),
        Ok(None) => Err(AppError::NotFound("No such manga on MyAnimeList".into())),
        Err(err) => Err(AppError::UpstreamUnavailable(format!(
            "MAL manga {mal_id}: {err}"
        ))),
    }
}

/// GET /api/external/mal/{mal_id}/recommendations
///
/// `{ "recommendations": [{ mal_id, title, image_url, votes }] }`.
/// 502 when no upstream answered — the caller must not mistake an
/// outage for "nothing to recommend" and remember it.
pub async fn mal_recommendations(
    State(state): State<AppState>,
    AuthenticatedUser(_user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    if mal_id <= 0 {
        return Ok(Json(serde_json::json!({ "recommendations": [] })));
    }
    let recommendations =
        mal_api::get_recommendations(&state.http_client, state.cache.as_deref(), mal_id)
            .await
            .map_err(|err| {
                AppError::UpstreamUnavailable(format!("MAL recommendations {mal_id}: {err}"))
            })?;
    Ok(Json(
        serde_json::json!({ "recommendations": recommendations }),
    ))
}

/// GET /api/external/mal/{mal_id}/characters
///
/// `{ "characters": [{ mal_id, name, role, image_url }] }`, for the
/// avatar picker. Jikan only — the official API has no characters.
pub async fn mal_characters(
    State(state): State<AppState>,
    AuthenticatedUser(_user): AuthenticatedUser,
    Path(mal_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    if mal_id <= 0 {
        return Ok(Json(serde_json::json!({ "characters": [] })));
    }
    let characters = mal_api::get_characters(&state.http_client, state.cache.as_deref(), mal_id)
        .await
        .map_err(|err| AppError::UpstreamUnavailable(format!("MAL characters {mal_id}: {err}")))?;
    Ok(Json(serde_json::json!({ "characters": characters })))
}
