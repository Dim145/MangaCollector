use axum::{
    routing::{delete, get, patch, post},
    Router,
};

use crate::handlers::{
    activity, auth as auth_handlers, coffret, external, health, library, public, seals, settings,
    storage, user_profile, volume,
};
use crate::state::AppState;

pub fn api_router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health::health))
        // Unified search endpoint — merges MAL + MangaDex results
        .route("/external/search", get(external::search))
        // Read-only public profile — `/public/u/{slug}` — no auth.
        // Nested under /api by the main router but carries no session
        // logic at the handler level so it's trivially cacheable later.
        .route("/public/u/{slug}", get(public::get_public_profile))
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
        .route("/library/{mal_id}/covers", get(library::list_covers))
        .route(
            "/library/{mal_id}/volume-covers",
            get(library::list_volume_covers),
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
        // PATCH sets the series' image_url_jpg to a whitelisted URL (cover
        // picker). Co-located with the other poster operations so it lives
        // under a 3-segment literal path — no risk of structural overlap
        // with /library/{mal_id}/{owned}, which was the root cause of the
        // 405 when PATCH was registered under /library/{mal_id}/poster.
        .route("/storage/poster/{mal_id}", patch(library::set_poster))
        .route("/storage/poster/{mal_id}", delete(storage::delete_poster))
        // Settings routes
        .route("/settings", get(settings::get_settings))
        .route("/settings", post(settings::update_settings))
        // Activity feed
        .route("/activity", get(activity::list_activity))
        // 印鑑帳 — Carnet de sceaux (ceremonial achievements)
        .route("/seals", get(seals::list_seals))
        // Public profile management:
        //   GET /public-slug    → full state { slug, show_adult }
        //   PATCH /public-slug  → set/change/clear the slug
        //   PATCH /public-adult → toggle adult-content opt-in
        .route("/public-slug", get(user_profile::get_public_slug))
        .route("/public-slug", patch(user_profile::update_public_slug))
        .route("/public-adult", patch(user_profile::update_public_adult))
        // GDPR — erase the entire account
        .route("/account", delete(auth_handlers::delete_account))
}
