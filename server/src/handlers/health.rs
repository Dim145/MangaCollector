use std::net::SocketAddr;

use axum::{extract::{ConnectInfo, State}, Json};
use serde::Serialize;

use crate::errors::AppError;
use crate::state::AppState;

#[derive(Serialize)]
pub struct HealthResponse {
    pub uptime: f64,
    pub message: &'static str,
    pub timestamp: i64,
    pub database: String,
}

pub async fn health(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Result<Json<HealthResponse>, AppError> {
    let is_local = match addr.ip() {
        std::net::IpAddr::V4(v4) => v4.is_loopback(),
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6
                    .to_ipv4_mapped()
                    .is_some_and(|v4| v4.is_loopback())
        }
    };

    if !state.config.app_unsecure_healthcheck && !is_local {
        return Err(AppError::NotFound("404 page not found".into()));
    }

    let db_status = state
        .db
        .ping()
        .await
        .map(|_| "OK".to_string())
        .unwrap_or_else(|_| "ERROR".to_string());

    let uptime = state.start_time.elapsed().as_secs_f64();
    let timestamp = chrono::Utc::now().timestamp_millis();

    Ok(Json(HealthResponse {
        uptime,
        message: "OK",
        timestamp,
        database: db_status,
    }))
}
