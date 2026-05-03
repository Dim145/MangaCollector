use std::net::SocketAddr;

use axum::{
    Json,
    extract::{ConnectInfo, State},
};
use serde::Serialize;

use crate::errors::AppError;
use crate::state::AppState;

#[derive(Serialize)]
pub struct HealthResponse {
    pub uptime: f64,
    pub message: &'static str,
    pub timestamp: i64,
    pub database: String,
    pub storage: String,
    /// Optional — only present when REDIS_URL is configured. `"OK"`,
    /// `"ERROR"`, or `"DISABLED"` when the cache is intentionally off.
    pub cache: String,
    /// Top-level summary: `"ok"` when every probed backend reports
    /// `"OK"`, `"degraded"` otherwise. The HTTP status stays 200 in
    /// the degraded case so monitoring can decide what to do.
    pub status: &'static str,
}

/// `/api/health` — internal monitoring endpoint.
///
/// IP gate: only loopback by default. Behind a reverse proxy (Traefik,
/// Nginx, k8s) the peer IP is the proxy's IP — typically inside a
/// Docker bridge network like `172.x.0.0/16`, NOT loopback. In that
/// topology the operator must set `APP_UNSECURE_HEALTHCHECK=true`
/// AND restrict access at the infra level (proxy ACL, NetworkPolicy).
/// Treating the proxy IP as "trusted" inside the app would expose
/// `/api/health` to any caller that can reach the bridge — that's a
/// network-perimeter concern, not an app one.
pub async fn health(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Result<Json<HealthResponse>, AppError> {
    let is_local = match addr.ip() {
        std::net::IpAddr::V4(v4) => v4.is_loopback(),
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback() || v6.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback())
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

    let storage_status = state
        .storage
        .ping()
        .await
        .map(|_| "OK".to_string())
        .unwrap_or_else(|_| "ERROR".to_string());

    let cache_status = match state.cache.as_deref() {
        None => "DISABLED".to_string(),
        Some(c) => c
            .ping()
            .await
            .map(|_| "OK".to_string())
            .unwrap_or_else(|_| "ERROR".to_string()),
    };

    let status = if db_status == "OK"
        && storage_status == "OK"
        && (cache_status == "OK" || cache_status == "DISABLED")
    {
        "ok"
    } else {
        "degraded"
    };

    let uptime = state.start_time.elapsed().as_secs_f64();
    let timestamp = chrono::Utc::now().timestamp_millis();

    Ok(Json(HealthResponse {
        uptime,
        message: "OK",
        timestamp,
        database: db_status,
        storage: storage_status,
        cache: cache_status,
        status,
    }))
}
