use axum::{Json, extract::State, http::header, response::IntoResponse};

use crate::observability::FrontendObservabilityConfig;
use crate::state::AppState;

/// `GET /api/public-config` — runtime configuration for the SPA.
///
/// Unauthenticated by design: the SPA fetches this on boot before any
/// session cookie is involved. The payload only contains values that
/// are safe to expose to anonymous visitors (DSNs, public website IDs,
/// SDK toggles) — it never carries secrets.
///
/// `Cache-Control: public, max-age=60` keeps a stale browser copy alive
/// for a minute so a soft refresh doesn't re-hit the backend; the
/// service worker layer (StaleWhileRevalidate on this path) provides
/// the offline fallback for longer outages.
pub async fn get_public_config(State(state): State<AppState>) -> impl IntoResponse {
    // Cloning the Arc-wrapped struct is a couple of bumps + a deep
    // clone of the inner strings. Cheap relative to JSON serialisation
    // and not on a hot path — every client hits this once per boot.
    let body: FrontendObservabilityConfig = (*state.frontend_config).clone();
    (
        [(
            header::CACHE_CONTROL,
            "public, max-age=60, stale-while-revalidate=600",
        )],
        Json(body),
    )
}
