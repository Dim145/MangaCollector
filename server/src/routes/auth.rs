use axum::{routing::{get, post}, Router};

use crate::handlers::auth as auth_handler;
use crate::state::AppState;

pub fn auth_router() -> Router<AppState> {
    Router::new()
        .route("/oauth2", get(auth_handler::start_oauth))
        .route("/oauth2/callback", get(auth_handler::oauth_callback))
        .route("/oauth2/logout", post(auth_handler::logout))
        .route("/user", get(auth_handler::get_auth_user))
        .route("/provider", get(auth_handler::get_auth_provider))
}
