//! Sentry / Bugsink + Umami environment configuration.
//!
//! Two distinct concerns live here:
//!
//! 1. **Backend SDK init** — `init()` reads `SENTRY_DSN` / `BUGSINK_DSN`
//!    (mutex enforced) and stands up the `sentry` Rust client whose
//!    transport runs on a background worker thread. Must run BEFORE
//!    the tracing subscriber so `sentry::integrations::tracing::layer()`
//!    can hook in and forward events.
//!
//! 2. **Frontend config exposure** — `frontend_config()` reads the
//!    `FRONTEND_*` env vars (separate mutex), validates them, and
//!    builds a struct that the backend serves verbatim to the SPA via
//!    `GET /api/public-config`. Same env-driven, fail-fast contract:
//!    misconfiguring two DSNs aborts startup.
//!
//! Status messages go to `eprintln!` instead of `tracing::info!` because
//! both validators run BEFORE the tracing subscriber is installed —
//! the subscriber wants to wrap the sentry-tracing layer, so sentry
//! has to come up first.

use anyhow::{Context, Result, anyhow, bail};
use serde::Serialize;
use std::env;

/// Reads `SENTRY_DSN` / `BUGSINK_DSN` from the environment, validates
/// the mutual-exclusion rule, and (when at least one is set) initialises
/// the Sentry client. Returns the guard so `main()` can keep the client
/// alive for the program's lifetime — dropping it triggers a flush.
///
/// `Ok(None)` means observability is opted out: both env vars are unset
/// or empty. Errors abort startup with a non-zero exit code.
pub fn init() -> Result<Option<sentry::ClientInitGuard>> {
    let sentry_dsn = env_nonempty("SENTRY_DSN");
    let bugsink_dsn = env_nonempty("BUGSINK_DSN");

    let (dsn, provider) = match (sentry_dsn, bugsink_dsn) {
        (Some(_), Some(_)) => {
            // Hard fail — see module docs for rationale.
            bail!(
                "SENTRY_DSN and BUGSINK_DSN are both set. They target the same SDK; \
                 configure exactly one (or neither, to disable error tracking)."
            );
        }
        (Some(dsn), None) => (dsn, "sentry"),
        (None, Some(dsn)) => (dsn, "bugsink"),
        (None, None) => return Ok(None),
    };

    let environment = env_nonempty("SENTRY_ENVIRONMENT").unwrap_or_else(|| "production".into());

    // Tracing is opt-in — sample rate defaults to 0.0 (errors only). Any
    // value > 0 turns on the per-request transaction layer below; the
    // value is also clamped to [0.0, 1.0] so a typo can't blow past 100%.
    let traces_sample_rate = parse_sample_rate("SENTRY_TRACES_SAMPLE_RATE")?;

    let dsn_parsed: sentry::types::Dsn = dsn
        .parse()
        .map_err(|e| anyhow!("invalid {provider} DSN: {e}"))?;

    let guard = sentry::init((
        dsn_parsed,
        sentry::ClientOptions {
            release: sentry::release_name!(),
            environment: Some(environment.into()),
            traces_sample_rate,
            // `attach_stacktrace = true` captures stack frames on every
            // event (not just panics) — useful for `tracing::error!`
            // events that wouldn't otherwise carry a backtrace.
            attach_stacktrace: true,
            // PII opt-out: don't send IP addresses or user agents by
            // default. Operators who want richer context can flip this
            // on per-deployment, but the default is GDPR-conservative.
            send_default_pii: false,
            ..Default::default()
        },
    ));

    eprintln!(
        "[observability] backend error tracking enabled · provider={provider} · traces_sample_rate={traces_sample_rate}"
    );

    Ok(Some(guard))
}

/// Public config served to the SPA at boot via `GET /api/public-config`.
///
/// Only error tracking lives here — Umami's config is injected directly
/// into `index.html` by the nginx container's envsubst entrypoint
/// (synchronous, no fetch round-trip, available before `main.jsx`
/// even runs). Sentry/Bugsink stay on the API path because the SDK
/// init is non-blocking by design and the cached payload survives
/// offline boots via the service worker.
///
/// `error_tracking` is `null` when neither DSN env var is set; the
/// frontend simply checks for null and skips init. None of these
/// fields carry secrets — DSNs are designed to be exposed to clients.
#[derive(Debug, Clone, Serialize)]
pub struct FrontendObservabilityConfig {
    #[serde(rename = "errorTracking")]
    pub error_tracking: Option<ErrorTrackingConfig>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorTrackingConfig {
    /// `"sentry"` or `"bugsink"` — diagnostic-only, the SDK behaves
    /// identically for both.
    pub provider: &'static str,
    pub dsn: String,
    pub environment: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release: Option<String>,
    #[serde(rename = "tracesSampleRate")]
    pub traces_sample_rate: f32,
    pub replay: bool,
}

/// Validates the `FRONTEND_*` env vars and builds the config payload
/// the backend will serve to the SPA. Runs at boot so misconfigurations
/// (both DSNs set) fail fast — the operator sees the error during
/// `docker compose up`, not at the user's first page load.
pub fn frontend_config() -> Result<FrontendObservabilityConfig> {
    let error_tracking = build_error_tracking_config()?;

    if let Some(ref t) = error_tracking {
        eprintln!(
            "[observability] frontend error tracking enabled · provider={} · traces_sample_rate={} · replay={}",
            t.provider, t.traces_sample_rate, t.replay
        );
    }

    Ok(FrontendObservabilityConfig { error_tracking })
}

fn build_error_tracking_config() -> Result<Option<ErrorTrackingConfig>> {
    let sentry_dsn = env_nonempty("FRONTEND_SENTRY_DSN");
    let bugsink_dsn = env_nonempty("FRONTEND_BUGSINK_DSN");

    let (dsn, provider) = match (sentry_dsn, bugsink_dsn) {
        (Some(_), Some(_)) => bail!(
            "FRONTEND_SENTRY_DSN and FRONTEND_BUGSINK_DSN are both set. They target the same SDK; \
             configure exactly one (or neither, to disable frontend error tracking)."
        ),
        (Some(dsn), None) => (dsn, "sentry"),
        (None, Some(dsn)) => (dsn, "bugsink"),
        (None, None) => return Ok(None),
    };

    let environment =
        env_nonempty("FRONTEND_SENTRY_ENVIRONMENT").unwrap_or_else(|| "production".into());
    let release = env_nonempty("FRONTEND_SENTRY_RELEASE");
    let traces_sample_rate = parse_sample_rate("FRONTEND_SENTRY_TRACES_SAMPLE_RATE")?;
    let replay = parse_bool("FRONTEND_SENTRY_REPLAY");

    Ok(Some(ErrorTrackingConfig {
        provider,
        dsn,
        environment,
        release,
        traces_sample_rate,
        replay,
    }))
}

fn env_nonempty(key: &str) -> Option<String> {
    env::var(key).ok().filter(|s| !s.is_empty())
}

fn parse_sample_rate(key: &str) -> Result<f32> {
    Ok(env_nonempty(key)
        .map(|s| s.parse::<f32>().with_context(|| format!("{key} must be a float")))
        .transpose()?
        .unwrap_or(0.0)
        .clamp(0.0, 1.0))
}

fn parse_bool(key: &str) -> bool {
    match env_nonempty(key) {
        Some(s) => matches!(s.to_lowercase().as_str(), "1" | "true" | "yes" | "on"),
        None => false,
    }
}
