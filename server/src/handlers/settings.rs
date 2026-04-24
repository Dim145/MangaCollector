use axum::{extract::State, Json};

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::models::setting::{SettingsResponse, UpdateSettingsRequest};
use crate::services::realtime::SyncKind;
use crate::services::settings;
use crate::state::AppState;

/// GET /api/user/settings
pub async fn get_settings(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<SettingsResponse>, AppError> {
    let row = settings::get_user_settings(&state.db, user.id).await?;

    let currency = settings::get_currency_by_code(&row.currency)
        .unwrap_or_else(|| settings::get_currency_by_code("USD").unwrap());

    Ok(Json(SettingsResponse {
        currency,
        title_type: row.title_type.unwrap_or_else(|| "Default".into()),
        adult_content_level: row.adult_content_level,
        theme: row.theme.unwrap_or_else(|| "dark".into()),
        language: row.language.unwrap_or_else(|| "en".into()),
        avatar_url: row.avatar_url,
        auth_name: state.config.auth_name.clone(),
        auth_icon: state.config.auth_icon.clone(),
    }))
}

/// POST /api/user/settings
pub async fn update_settings(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(body): Json<UpdateSettingsRequest>,
) -> Result<Json<SettingsResponse>, AppError> {
    let row = settings::update_user_settings(&state.db, user.id, &body).await?;
    state.broker.publish(user.id, SyncKind::Settings).await;

    let currency = settings::get_currency_by_code(&row.currency)
        .unwrap_or_else(|| settings::get_currency_by_code("USD").unwrap());

    Ok(Json(SettingsResponse {
        currency,
        title_type: row.title_type.unwrap_or_else(|| "Default".into()),
        adult_content_level: row.adult_content_level,
        theme: row.theme.unwrap_or_else(|| "dark".into()),
        language: row.language.unwrap_or_else(|| "en".into()),
        avatar_url: row.avatar_url,
        auth_name: state.config.auth_name.clone(),
        auth_icon: state.config.auth_icon.clone(),
    }))
}
