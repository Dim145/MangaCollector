use axum::{
    extract::{Query, State},
    response::{IntoResponse, Redirect},
    Json,
};
use serde_json::json;
use tower_sessions::Session;

use crate::auth::{
    build_auth_url, exchange_code_for_user, CallbackQuery, AuthenticatedUser,
    SESSION_CSRF_TOKEN, SESSION_NONCE, SESSION_PKCE_VERIFIER, SESSION_USER_ID,
};
use crate::errors::AppError;
use crate::services::users;
use crate::state::AppState;

/// GET /auth/oauth2 — start OAuth2 / OIDC flow
pub async fn start_oauth(
    State(state): State<AppState>,
    session: Session,
) -> Result<impl IntoResponse, AppError> {
    let oidc = state.oidc_client.as_ref();
    let start_data = build_auth_url(&oidc.client);

    session
        .insert(SESSION_PKCE_VERIFIER, &start_data.pkce_verifier)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    session
        .insert(SESSION_CSRF_TOKEN, &start_data.csrf_token)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    session
        .insert(SESSION_NONCE, &start_data.nonce)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Redirect::to(&start_data.auth_url))
}

/// GET /auth/oauth2/callback
pub async fn oauth_callback(
    State(state): State<AppState>,
    Query(params): Query<CallbackQuery>,
    session: Session,
) -> Result<impl IntoResponse, AppError> {
    // Verify CSRF state
    let stored_csrf: Option<String> = session
        .get(SESSION_CSRF_TOKEN)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if stored_csrf.as_deref() != Some(&params.state) {
        return Err(AppError::BadRequest("CSRF state mismatch".into()));
    }

    let pkce_verifier: String = session
        .get(SESSION_PKCE_VERIFIER)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .ok_or_else(|| AppError::BadRequest("Missing PKCE verifier".into()))?;

    let nonce: String = session
        .get(SESSION_NONCE)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .ok_or_else(|| AppError::BadRequest("Missing nonce".into()))?;

    // Clean up one-time session values
    let _ = session.remove::<String>(SESSION_PKCE_VERIFIER).await;
    let _ = session.remove::<String>(SESSION_CSRF_TOKEN).await;
    let _ = session.remove::<String>(SESSION_NONCE).await;

    let user_info = exchange_code_for_user(
        &state.oidc_client.client,
        &state.oidc_client.http_client,
        params.code,
        pkce_verifier,
        nonce,
    )
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    // Find or create user
    let user = match users::find_by_provider_id(&state.db, &user_info.provider_id).await? {
        Some(u) => u,
        None => users::create(
            &state.db,
            &user_info.provider_id,
            user_info.email.as_deref(),
            user_info.name.as_deref(),
        )
        .await?,
    };

    session
        .insert(SESSION_USER_ID, user.id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Redirect::to(&state.config.frontend_url))
}

/// POST /auth/oauth2/logout
pub async fn logout(session: Session) -> Result<Json<serde_json::Value>, AppError> {
    session
        .delete()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(json!({ "message": "Logged out successfully" })))
}

/// DELETE /api/user/account
///
/// GDPR "erasure" endpoint: wipes the user's entire footprint — posters,
/// library, volumes, coffrets, activity, settings, then the user row
/// itself — and destroys the session. The frontend receives a 200 and
/// navigates to `/`; a subsequent request will 401 because the session
/// cookie now references a deleted session AND a deleted user.
pub async fn delete_account(
    State(state): State<AppState>,
    session: Session,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    users::delete_account(&state.db, state.storage.clone(), user.id).await?;
    // Destroy the session after the DB wipe so we know the cleanup
    // succeeded before logging the user out. If session.delete() fails
    // after a successful wipe, the user is already deleted — the stale
    // session will 401 on the next request anyway.
    let _ = session.delete().await;
    Ok(Json(json!({ "success": true })))
}

/// GET /auth/user
pub async fn get_auth_user(
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::to_value(&user).unwrap()))
}

/// GET /auth/provider — public info about the configured OAuth provider
pub async fn get_auth_provider(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    Json(json!({
        "authName": state.config.auth_name,
        "authIcon": state.config.auth_icon,
    }))
}
