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

    #[error("{0}")]
    Conflict(String),

    #[error("Database error: {0}")]
    Database(String),

    // NB: no `#[from]` on the inner `anyhow::Error` deliberately. The
    // previous blanket auto-conversion meant any `anyhow::Error` raised
    // anywhere in the call graph (e.g. a reqwest failure talking to
    // MangaDex) was silently re-labelled as a "Storage error" and sent
    // back as a 500 — confusing in logs and misleading to operators. By
    // requiring an explicit `.map_err(AppError::Storage)` at the actual
    // storage call sites, other callers that wrap anyhow must pick a
    // more accurate variant (`Internal`, `BadRequest`, etc.).
    #[error("Storage error: {0}")]
    Storage(anyhow::Error),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        // Log the full error message at ERROR level for 5xx variants
        // BEFORE serialising the response. The tower_http trace layer
        // only emits "500 Internal Server Error · latency=Xms" with
        // the method+uri span context — without this, the actual
        // cause (DB error string, storage backend error, etc.) never
        // reaches the server logs and every 500 becomes a mystery.
        match &self {
            AppError::Database(msg) => {
                tracing::error!(error = %msg, "database error -> 500");
            }
            AppError::Storage(e) => {
                tracing::error!(error = %e, "storage error -> 500");
            }
            AppError::Internal(msg) => {
                tracing::error!(error = %msg, "internal error -> 500");
            }
            // 4xx: quieter; they're usually user-input problems, not
            // operator-actionable. Log at DEBUG so they're available
            // when explicitly asked for but don't pollute the default
            // log stream.
            AppError::NotFound(msg)
            | AppError::BadRequest(msg)
            | AppError::Conflict(msg) => {
                tracing::debug!(error = %msg, "client error");
            }
            AppError::Unauthorized => {}
        }
        // Public-facing body.
        //
        // 4xx variants pass their message through unchanged — the text
        // is specifically written to be read by the end-user (e.g.
        // "Manga not found in user's library", "Cannot copy from
        // yourself"). Leaking these is the whole point.
        //
        // 5xx variants ALWAYS respond with a fixed generic string. The
        // detailed cause (DB constraint names, S3 keys, internal file
        // paths, sqlx error strings that echo bits of the SQL) is
        // logged above at ERROR level with enough context to debug,
        // but the client gets nothing exploitable. This is the OWASP
        // recommendation for "Improper Error Handling" (A04:2021).
        const GENERIC_5XX: &str = "Internal server error";
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
            AppError::Conflict(msg) => (
                StatusCode::CONFLICT,
                json!({ "success": false, "error": msg }),
            ),
            AppError::Database(_) | AppError::Storage(_) | AppError::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "success": false, "error": GENERIC_5XX }),
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
