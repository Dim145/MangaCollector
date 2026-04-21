use axum::{
    routing::{delete, get, patch, post},
    Router,
};

use crate::handlers::{activity, coffret, external, health, library, settings, storage, volume};
use crate::state::AppState;

pub fn api_router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health::health))
        // Unified search endpoint — merges MAL + MangaDex results
        .route("/external/search", get(external::search))
        .nest("/user", user_router())
}

fn user_router() -> Router<AppState> {
    Router::new()
        // Library routes — note: /library/search and /library/custom must be
        // registered before /library/{mal_id} so Axum's specificity matching
        // correctly prefers literal segments.
        .route("/library", get(library::get_user_library))
        .route("/library/search", get(library::search_library))
        .route("/library/custom", post(library::add_custom_entry))
        .route("/library/mangadex", post(library::add_from_mangadex))
        .route("/library", post(library::add_to_library))
        .route("/library/{mal_id}", get(library::get_user_manga))
        .route(
            "/library/{mal_id}/update-from-mal",
            get(library::update_from_mal),
        )
        .route(
            "/library/{mal_id}/refresh-from-mangadex",
            get(library::refresh_from_mangadex),
        )
        .route("/library/{mal_id}", patch(library::update_manga))
        .route(
            "/library/{mal_id}/{owned}",
            patch(library::update_manga_owned),
        )
        .route("/library/{mal_id}", delete(library::delete_manga))
        // Volume routes
        .route("/volume", get(volume::get_all_volumes))
        .route("/volume/{mal_id}", get(volume::get_volumes_by_id))
        .route("/volume", patch(volume::update_volume))
        // Coffret routes — list/create scoped to a manga, delete by coffret id
        .route(
            "/library/{mal_id}/coffrets",
            get(coffret::list_for_manga),
        )
        .route(
            "/library/{mal_id}/coffrets",
            post(coffret::create),
        )
        .route("/coffrets/{id}", patch(coffret::update))
        .route("/coffrets/{id}", delete(coffret::delete))
        // Storage routes
        .route("/storage/poster/{mal_id}", get(storage::get_poster))
        .route("/storage/poster/{mal_id}", post(storage::upload_poster))
        .route("/storage/poster/{mal_id}", delete(storage::delete_poster))
        // Settings routes
        .route("/settings", get(settings::get_settings))
        .route("/settings", post(settings::update_settings))
        // Activity feed
        .route("/activity", get(activity::list_activity))
}
