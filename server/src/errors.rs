use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::json;

#[derive(thiserror::Error, Debug)]
pub enum AppError {
    #[error("Not authenticated")]
    Unauthorized,

    #[error("{0}")]
    NotFound(String),

    #[error("{0}")]
    BadRequest(String),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Storage error: {0}")]
    Storage(#[from] anyhow::Error),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, body) = match &self {
            AppError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                json!({ "error": self.to_string() }),
            ),
            AppError::NotFound(msg) => (
                StatusCode::NOT_FOUND,
                json!({ "success": false, "error": msg }),
            ),
            AppError::BadRequest(msg) => (
                StatusCode::BAD_REQUEST,
                json!({ "success": false, "error": msg }),
            ),
            AppError::Database(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "success": false, "error": msg }),
            ),
            AppError::Storage(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "success": false, "error": e.to_string() }),
            ),
            AppError::Internal(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "success": false, "error": msg }),
            ),
        };
        (status, Json(body)).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Database(e.to_string())
    }
}

impl From<sea_orm::DbErr> for AppError {
    fn from(e: sea_orm::DbErr) -> Self {
        AppError::Database(e.to_string())
    }
}
