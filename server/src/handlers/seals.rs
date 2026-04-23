use axum::{extract::State, Json};

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::models::user_seal::SealsResponse;
use crate::services::seals;
use crate::state::AppState;

/// GET /api/user/seals
///
/// Evaluates the catalog against the user's current stats, grants any
/// newly-qualifying seals in the same request, and returns the complete
/// carnet. The response includes `newly_granted: [code]` so the client
/// can play a one-time ceremonial stamp animation on first sight.
pub async fn list_seals(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<SealsResponse>, AppError> {
    let resp = seals::evaluate_and_grant(&state.db, user.id).await?;
    Ok(Json(resp))
}
