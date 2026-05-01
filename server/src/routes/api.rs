use axum::{
    routing::{delete, get, patch, post},
    Router,
};

use crate::handlers::{
    activity, archive, auth as auth_handlers, calendar, coffret, compare, external,
    external_import, health, library, public, public_config, realtime, seals, settings, storage,
    user_profile, volume,
};
use crate::state::AppState;

pub fn api_router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health::health))
        // 設 · Public runtime config for the SPA — DSNs, Umami script
        // URL/website ID, etc. No auth (the SPA fetches it before any
        // session exists). Cached aggressively via the SW so an offline
        // boot sees the last-known config instead of failing init.
        .route("/public-config", get(public_config::get_public_config))
        // Unified search endpoint — merges MAL + MangaDex results
        .route("/external/search", get(external::search))
        // Read-only public profile — `/public/u/{slug}` — no auth.
        // Nested under /api by the main router but carries no session
        // logic at the handler level so it's trivially cacheable later.
        .route("/public/u/{slug}", get(public::get_public_profile))
        // Companion endpoint for the gallery's custom-uploaded covers:
        // the private `/storage/poster/{mal_id}` route resolves the
        // blob against the CALLER's library, which 404s for cross-user
        // or anonymous visitors of a public profile / compare page.
        // This route scopes the lookup to the target user (by slug) and
        // reuses the exact same visibility rules as the profile payload
        // (public_slug still active + adult-content filter).
        .route(
            "/public/u/{slug}/poster/{mal_id}",
            get(public::get_public_poster),
        )
        // 同期 — Realtime sync WebSocket. Authenticates via the same
        // session cookie as the REST endpoints and streams invalidation
        // events scoped to the user. Anonymous visitors get 401.
        .route("/ws", get(realtime::ws_handler))
        // 暦 · Public ICS calendar feed. Auth is the secret token in
        // the path — there's no cookie sent by Apple Calendar /
        // Google Calendar / Outlook when they refresh a subscribed
        // URL. Mounted on the api-router (not user-router) so the
        // session middleware doesn't 401 anonymous polls.
        .route(
            "/calendar/{token}",
            get(calendar::ics_feed_by_token),
        )
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
        // 来 · Discover & reconcile announced upcoming volumes for
        // this series. POST because the call mutates state (inserts
        // new user_volumes rows, may update existing ones), even
        // though no body is required.
        .route(
            "/library/{mal_id}/refresh-upcoming",
            post(library::refresh_upcoming),
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
        // 来 · Manually pencil in an upcoming volume — runs alongside
        // the API-cascade `refresh_upcoming` above, but works on
        // custom series (mal_id < 0) too where the cascade can't.
        .route(
            "/library/{mal_id}/volumes/upcoming",
            post(volume::add_upcoming_volume),
        )
        // 一括 · Bulk-mark cascade — sets `owned` and/or `read` on
        // every released volume of a series in one round-trip.
        // Powers the dashboard's bulk-actions bar.
        .route(
            "/library/{mal_id}/volumes/bulk-mark",
            post(volume::bulk_mark_volumes),
        )
        // Volume routes — note: the legacy `/volume/{mal_id}` is a list
        // endpoint scoped by mal_id (returns every volume of a series),
        // while `/volumes/{id}` (plural) targets a single volume by its
        // primary key. We keep them distinct because Axum's router
        // matches on parameter NAMES at the same depth — registering
        // `/volume/{id}` alongside `/volume/{mal_id}` panics at startup
        // with an "Insertion failed due to conflict" error. The plural
        // namespace mirrors the existing convention for `/coffrets/{id}`
        // and `/sessions/{session_id}`.
        .route("/volume", get(volume::get_all_volumes))
        .route("/volume/{mal_id}", get(volume::get_volumes_by_id))
        .route("/volume", patch(volume::update_volume))
        // 来 · Edit / delete a manually-created upcoming volume by id.
        // API-origin rows are still served by these routes, but the
        // service layer rejects them with 409 so the nightly sweep
        // keeps authority over what it produced.
        .route(
            "/volumes/{id}/upcoming",
            patch(volume::update_upcoming_volume),
        )
        .route("/volumes/{id}", delete(volume::delete_volume))
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
        // 暦 · Upcoming-volume calendar feed. Optional `?from=YYYY-MM`
        // and `?until=YYYY-MM`; defaults span the next 12 months.
        // Returns a flat list joined with series metadata so the
        // SPA can render Month / Agenda views without further fanout.
        .route(
            "/calendar/upcoming",
            get(calendar::list_upcoming),
        )
        // 暦 · Subscribable ICS feed token lifecycle. The actual feed
        // is mounted at the api-router level (below) without auth —
        // the token in the URL IS the auth. Both endpoints here are
        // user-scoped and require a session.
        .route(
            "/calendar/ics-url",
            get(calendar::get_ics_url),
        )
        .route(
            "/calendar/ics-url/regenerate",
            post(calendar::regenerate_ics_url),
        )
        // 対照 — Compare my library with a public profile slug + add
        // a missing series from their library to mine.
        .route("/compare/{slug}", get(compare::compare_with))
        .route("/compare/{slug}/add/{mal_id}", post(compare::copy_entry))
        // Public profile management:
        //   GET /public-slug    → full state { slug, show_adult }
        //   PATCH /public-slug  → set/change/clear the slug
        //   PATCH /public-adult → toggle adult-content opt-in
        .route("/public-slug", get(user_profile::get_public_slug))
        .route("/public-slug", patch(user_profile::update_public_slug))
        .route("/public-adult", patch(user_profile::update_public_adult))
        // 祝 · birthday mode — open the wishlist publicly for N days
        // (server clamps to 365d max; days<=0 disables).
        .route(
            "/wishlist-public",
            patch(user_profile::update_wishlist_public),
        )
        // 写本 · Archive — portable export / merge-import.
        .route("/export.json", get(archive::export_json))
        .route("/export.csv", get(archive::export_csv))
        .route("/import", post(archive::import_archive))
        // 外部輸入 · External import — fetch a library from another
        // service and return a bundle + dry-run preview in one call.
        .route("/import/external/mal", post(external_import::import_mal))
        .route("/import/external/anilist", post(external_import::import_anilist))
        .route("/import/external/mangadex", post(external_import::import_mangadex))
        .route("/import/external/yamtrack", post(external_import::import_yamtrack))
        // GDPR — erase the entire account
        .route("/account", delete(auth_handlers::delete_account))
        // 機 · Active session listing + revocation. The user can see
        // every device currently signed in to their account and
        // revoke any of them; the request that issued the call is
        // flagged so the SPA can highlight (and special-case) it.
        .route("/sessions", get(auth_handlers::list_sessions))
        .route(
            "/sessions/{session_id}",
            delete(auth_handlers::revoke_session),
        )
}
