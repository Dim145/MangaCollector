use std::net::SocketAddr;

use axum::{
    Json,
    extract::{ConnectInfo, State},
    http::StatusCode,
};
use serde::Serialize;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::handlers::health::is_loopback;
use crate::services::rum::{self, Beacon, SummaryRow};
use crate::state::AppState;

/// `POST /api/rum` — the Core Web Vitals a reader's browser measured,
/// sent in a beacon when a page is hidden (`client/src/lib/rum.js`).
///
/// 404 unless the operator set `RUM_ENABLED`. A session is required:
/// the SPA only reports for signed-in readers, and it keeps strangers
/// from filling the store — though nothing about the reader is kept.
/// Each believable value is logged under the `mc_rum` target (ship the
/// logs wherever the rest go) and counted for `GET /api/rum/summary`.
pub async fn collect(
    State(state): State<AppState>,
    _reader: AuthenticatedUser,
    Json(beacon): Json<Beacon>,
) -> Result<StatusCode, AppError> {
    let Some(store) = state.rum.as_deref() else {
        return Err(AppError::NotFound("404 page not found".into()));
    };
    let (context, samples) = rum::accept(beacon);
    for sample in &samples {
        tracing::info!(
            target: "mc_rum",
            route = %sample.route,
            metric = sample.metric,
            value = sample.value,
            rating = sample.rating.unwrap_or("-"),
            navigation = sample.navigation.as_deref().unwrap_or("-"),
            element = sample.target.as_deref().unwrap_or("-"),
            input = sample.input.unwrap_or("-"),
            phases = ?sample.phases,
            app = context.app.as_deref().unwrap_or("-"),
            mobile = ?context.mobile,
            connection = context.connection.unwrap_or("-"),
            "web vital"
        );
        store.record(sample);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
pub struct RumSummary {
    /// Seconds the values were gathered over — the store lives in memory
    /// and starts empty with the process.
    pub uptime: u64,
    pub rows: Vec<SummaryRow>,
}

/// `GET /api/rum/summary` — p50 / p75 / p95 per page and metric, over
/// the last values received. Same gate as `/api/health`: this machine
/// only, unless `APP_UNSECURE_HEALTHCHECK` says otherwise.
pub async fn summary(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Result<Json<RumSummary>, AppError> {
    let Some(store) = state.rum.as_deref() else {
        return Err(AppError::NotFound("404 page not found".into()));
    };
    if !state.config.app_unsecure_healthcheck && !is_loopback(&addr) {
        return Err(AppError::NotFound("404 page not found".into()));
    }
    Ok(Json(RumSummary {
        uptime: state.start_time.elapsed().as_secs(),
        rows: store.summary(),
    }))
}
