use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::{IntoResponse, Redirect},
    Json,
};
use axum::extract::Path;
use serde_json::json;
use tower_sessions::Session;

use crate::auth::{
    build_auth_url, exchange_code_for_user, CallbackQuery, AuthenticatedUser,
    SESSION_CSRF_TOKEN, SESSION_NONCE, SESSION_PKCE_VERIFIER, SESSION_USER_ID,
};
use crate::errors::AppError;
use crate::services::{sessions, users};
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
    headers: HeaderMap,
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

    // 機 · Record this session in our parallel `user_session_meta`
    // table. INSERT (with ON CONFLICT update) lives ONLY here; the
    // `AuthenticatedUser` extractor below uses an UPDATE-only `touch`.
    // That asymmetry is what makes `revoke` stick — once a row is
    // deleted, it can only be re-created via a fresh OAuth login,
    // not by a leftover cookie hitting the extractor.
    if let Some(session_id) = session.id().map(|id| id.to_string()) {
        let user_agent = headers
            .get(axum::http::header::USER_AGENT)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        sessions::record_login(&state.db, &session_id, user.id, user_agent).await;
    }

    Ok(Redirect::to(&state.config.frontend_url))
}

/// GET /api/user/sessions — list every active session for the current user.
///
/// Returns the most recently active first; the row that issued the
/// request is flagged via `is_current` so the SPA can render the
/// "this device" pill.
pub async fn list_sessions(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    session: Session,
) -> Result<Json<serde_json::Value>, AppError> {
    let current = session.id().map(|id| id.to_string()).unwrap_or_default();
    let entries = sessions::list_for_user(&state.db, user.id, &current).await?;
    Ok(Json(json!({ "sessions": entries })))
}

/// DELETE /api/user/sessions/{session_id} — revoke a session.
///
/// 404 when the session doesn't exist (already gone) or doesn't belong
/// to the requesting user. Revoking the current session is allowed —
/// the SPA treats it the same as logout.
pub async fn revoke_session(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let removed = sessions::revoke(&state.db, user.id, &session_id).await?;
    if !removed {
        return Err(AppError::NotFound("Session not found".into()));
    }
    Ok(Json(json!({ "success": true })))
}

/// POST /auth/oauth2/logout
pub async fn logout(
    State(state): State<AppState>,
    session: Session,
) -> Result<Json<serde_json::Value>, AppError> {
    // Capture the id BEFORE delete: `session.delete()` resets the
    // session-id lock once it's done, so a `session.id()` after the
    // delete would give us None.
    let session_id = session.id().map(|id| id.to_string());

    session
        .delete()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // 機 · Drop the parallel meta row so the user's "active sessions"
    // listing stops showing this device. Best-effort — a logout
    // should never bounce on a meta-cleanup hiccup.
    if let Some(id) = session_id {
        sessions::delete_meta(&state.db, &id).await;
    }

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
///
/// Returns the minimal fields the SPA needs to render a "who am I"
/// state. Serialising the raw `User` model would leak `google_id`
/// (OIDC subject) and `email` — both usable by an XSS payload to
/// identify or phish the user, neither needed by the frontend.
pub async fn get_auth_user(
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<crate::models::user::AuthUserResponse>, AppError> {
    Ok(Json((&user).into()))
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
