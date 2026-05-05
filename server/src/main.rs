mod auth;
mod config;
mod db;
mod errors;
mod handlers;
mod models;
mod observability;
mod routes;
mod services;
mod state;
mod storage;
mod util;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use axum::extract::Request;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Router;
use http::{HeaderValue, Method, StatusCode};
use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};
use tower_http::cors::CorsLayer;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::{DefaultMakeSpan, DefaultOnFailure, DefaultOnResponse, TraceLayer};
use tower_sessions::cookie::time::Duration;
use tower_sessions::cookie::SameSite;
use tower_sessions::{Expiry, SessionManagerLayer};
use tower_sessions_sqlx_store::PostgresStore;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use crate::config::StorageConfig;
use crate::services::cache::CacheStore;
use crate::state::AppState;
use crate::storage::{LocalStorage, S3Storage, StorageBackend};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Health-check subcommand: loopback HTTP call to /api/health, exit 0 on
    // success and 1 on failure. Invoked by the Docker HEALTHCHECK so the
    // scratch-based image doesn't need curl/wget.
    if std::env::args().any(|a| a == "--health") {
        std::process::exit(run_health_check().await);
    }

    // Error tracking — initialise BEFORE the tracing subscriber so the
    // sentry-tracing layer can hook into it and forward `tracing::error!`
    // events as Sentry breadcrumbs. The guard must outlive `main()`; on
    // drop it flushes pending events with a short timeout. Hard-fails on
    // misconfiguration (e.g. both DSN env vars set) — see `observability`.
    let _sentry_guard = observability::init()?;

    // Frontend observability config — resolved here so misconfigurations
    // (FRONTEND_SENTRY_DSN + FRONTEND_BUGSINK_DSN both set) abort the
    // boot rather than surfacing later as a 500 from /api/public-config.
    // Stashed in AppState; the handler returns it verbatim.
    let frontend_obs_config = std::sync::Arc::new(observability::frontend_config()?);

    // Initialise tracing
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        .with(sentry::integrations::tracing::layer())
        .init();

    // Load configuration
    let config = config::Config::from_env()?;
    let port = config.port;
    let frontend_url = config.frontend_url.clone();
    // Pull out the security / rate-limit tunables before `config` is
    // moved into `AppState`. Keeping them as named bindings mirrors
    // the `port` / `frontend_url` pattern above and keeps the layer
    // wiring below readable.
    let rate_limit_enabled = config.rate_limit_enabled;
    let rate_limit_period_seconds = config.rate_limit_period_seconds;
    let rate_limit_burst_size = config.rate_limit_burst_size;
    let x_frame_options = config.x_frame_options.clone();

    // Database: create sqlx pool, run migrations, then wrap in SeaORM connection
    let pool = db::create_pool(&config.postgres_url).await?;
    db::run_migrations(&pool).await?;
    let orm_db = db::create_db(pool.clone());

    // Storage backend
    let storage: Arc<dyn StorageBackend> = match &config.storage {
        StorageConfig::S3 { .. } => Arc::new(S3Storage::new(&config.storage)),
        StorageConfig::Local { dir } => Arc::new(LocalStorage::new(dir.clone())),
    };

    // OIDC client (performs discovery HTTP call at startup)
    let oidc_client = auth::build_oidc_client(&config).await?;

    // HTTP client for outbound requests (MAL API, MangaDex, AniList,
    // OIDC discovery). Timeouts are mandatory: without them, a stalled
    // upstream keeps a tokio task parked indefinitely and — under any
    // real load — eventually starves the connection pool. The split
    // between `connect_timeout` and the outer `timeout` lets legitimate
    // but slow upstream responses finish while killing dead sockets
    // fast.
    let http_client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("reqwest client builder should not fail with defaults");

    // Redis cache (optional). Connection failure is logged but doesn't abort
    // startup — services degrade to direct-API mode when the cache is absent.
    let cache: Option<Arc<CacheStore>> = match config.redis_url.as_deref() {
        Some(url) => match CacheStore::connect(url, config.cache_prefix.clone()) {
            Ok(store) => match store.ping().await {
                Ok(()) => {
                    tracing::info!(
                        prefix = %config.cache_prefix,
                        "Cache enabled (Redis reachable)"
                    );
                    Some(Arc::new(store))
                }
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        "Cache disabled: Redis PING failed. Will degrade to direct API calls."
                    );
                    None
                }
            },
            Err(e) => {
                tracing::warn!(error = %e, "Cache disabled: invalid REDIS_URL");
                None
            }
        },
        None => {
            tracing::info!("Cache disabled: REDIS_URL not set");
            None
        }
    };

    // Realtime sync broker — uses the same Redis URL when available so
    // mutation events propagate across backend instances. Falls back to
    // an in-memory broadcast in single-instance / Redis-less setups.
    let broker = match config.redis_url.as_deref() {
        Some(url) => {
            tracing::info!("Realtime sync: Redis-backed (scales across instances)");
            crate::services::realtime::SyncBroker::with_redis(url).await
        }
        None => {
            tracing::info!("Realtime sync: in-memory (single-instance deploys)");
            crate::services::realtime::SyncBroker::in_memory()
        }
    };

    // Session store backed by PostgreSQL (uses raw sqlx pool)
    let session_store = PostgresStore::new(pool.clone());
    session_store.migrate().await?;

    // Cookie-security posture — derived, not hard-coded:
    //   • Secure: only when the frontend is served over HTTPS. That's
    //     the contract in prod; flipping it on for http://localhost
    //     would make the browser refuse to store the cookie and break
    //     local dev. `starts_with("https://")` is the simple heuristic.
    //   • HttpOnly: always on. There is no legitimate reason for JS to
    //     read the session cookie — login state is detected via the
    //     existing `/auth/user` call, and we never set CSRF tokens as
    //     cookie values. Flipping it off would make session theft via
    //     any stored-XSS trivial.
    //   • SameSite=Lax: stays. Strict breaks the OAuth redirect flow
    //     (provider → /auth/callback is a top-level navigation that
    //     must carry our session cookie to look up the PKCE verifier),
    //     and Lax is already strong enough: browsers drop cookies on
    //     cross-site POST/PATCH/DELETE, which is the exact CSRF shape
    //     we care about. Additional Origin-based defence-in-depth
    //     lives in the `csrf_origin_guard` middleware below.
    let cookie_secure = frontend_url.starts_with("https://");
    if !cookie_secure {
        tracing::warn!(
            frontend_url = %frontend_url,
            "Session cookie Secure=false (frontend is not https). Fine for local dev; \
             NEVER acceptable in prod — session cookies will travel in clear over HTTP."
        );
    }
    let session_layer = SessionManagerLayer::new(session_store)
        .with_secure(cookie_secure)
        .with_http_only(true)
        .with_same_site(SameSite::Lax)
        .with_expiry(Expiry::OnInactivity(Duration::days(30)));

    // 活動 · Activity-feed coalescing buffer. Holds toggleable
    // events for a few seconds so a rapid undo cancels both sides
    // instead of leaving a noise pair in the feed. The buffer
    // owns its own `Db` clone (SeaORM connections are Arc-backed
    // — sharing the pool is essentially free).
    let activity = crate::services::activity_coalescer::ActivityCoalescer::new(
        orm_db.clone(),
        crate::services::activity_coalescer::DEFAULT_DELAY,
    );

    // Application state
    let state = AppState {
        db: orm_db,
        pool,
        config: Arc::new(config),
        storage,
        oidc_client: Arc::new(oidc_client),
        http_client,
        cache,
        broker,
        activity,
        frontend_config: frontend_obs_config,
        start_time: Instant::now(),
    };

    // 機 · Periodic pruning of stale `user_session_meta` rows.
    //
    // The FK + ON DELETE CASCADE that used to bind meta rows to
    // `"tower_sessions"."session"` was dropped (cf. migration
    // `20260426150000_drop_session_meta_fk.sql`) because tower-
    // sessions cycles ids on record-not-found recovery, which made
    // the constraint reject perfectly valid meta inserts.
    //
    // Without that cascade, meta rows whose corresponding session is
    // GC'd by tower-sessions stick around indefinitely. The
    // `last_seen_at`-based filter on `list_for_user` keeps them
    // *invisible*, but the table grows unbounded — a power user
    // logging in from many devices, or any kind of session churn
    // (incognito tabs, device wipes), accumulates rows linearly.
    //
    // Run every 6 h, deleting rows whose `last_seen_at` is more than
    // 60 days old (= 2× the visibility window). Best-effort: errors
    // are logged but never escalated, the next tick will retry.
    crate::services::jobs::spawn_supervised(
        "session_meta_cleanup",
        crate::services::jobs::prune_session_meta_loop(state.db.clone()),
    );

    // 来 · Nightly upcoming-volume sweep.
    //
    // Once per day, walk every distinct series present in any user's
    // library and call the discovery cascade (`releases::discover_upcoming`).
    // For each user who follows the series, reconcile against their
    // `user_volumes` rows so newly-announced tomes land automatically
    // — no need for the user to remember to click "Refresh upcoming".
    //
    // Two design choices worth flagging:
    //
    //   1. We sleep ~330 ms between series so MangaUpdates' rate
    //      limit (informally ~5 req/s) stays comfortable. A library
    //      of 1 000 distinct series → ~5.5 minutes per pass, which
    //      is fine for a nightly job. If we ever want faster, a
    //      semaphore + parallel bucket would multiplex without
    //      surpassing the rate.
    //
    //   2. Errors are logged and the loop carries on — a single bad
    //      title shouldn't poison the rest of the nightly run.
    //
    // Schedule: 24 h interval, first tick after a 30 min delay so a
    // restart-storm doesn't fan out to upstream APIs at boot. Run
    // exactly once on a startup-near-04:00 UTC instance to align
    // with the audit's planned cadence; on other instances it just
    // ticks every 24 h relative to the boot time.
    crate::services::jobs::spawn_supervised(
        "nightly_upcoming_sweep",
        crate::services::jobs::nightly_upcoming_sweep(
            state.db.clone(),
            state.http_client.clone(),
            state.cache.clone(),
            state.broker.clone(),
            state.config.clone(),
        ),
    );

    // CORS — explicitly allow only the methods + headers the SPA
    // actually uses. The earlier `Any` permission was already gated by
    // the CSRF Origin guard, but defence-in-depth: a future endpoint
    // that forgets the guard still benefits from a tight CORS contract.
    let origin: HeaderValue = frontend_url
        .parse()
        .expect("FRONTEND_URL must be a valid header value");

    let cors = CorsLayer::new()
        .allow_origin(origin)
        .allow_credentials(true)
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PATCH,
            axum::http::Method::DELETE,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::ACCEPT,
            axum::http::header::AUTHORIZATION,
            axum::http::header::ORIGIN,
            axum::http::header::COOKIE,
            axum::http::header::HeaderName::from_static("x-requested-with"),
        ]);

    // Router
    //
    // Body-size budget — Axum's default DefaultBodyLimit is 2 MiB. That
    // bites the archive-import path the moment a user uploads a real
    // Yamtrack / MAL / etc. CSV export (2 MB lists are common beyond a
    // hundred entries). Default to 10 MiB globally; operators can
    // override with `MAX_BODY_SIZE_MB` (in whole megabytes) when they
    // need headroom for bigger imports. Clamped to a sane [1, 1024]
    // window so a typo'd value can't accidentally disable the guard.
    let max_body_mb = std::env::var("MAX_BODY_SIZE_MB")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .map(|n| n.clamp(1, 1024))
        .unwrap_or(10);
    let max_body_bytes = (max_body_mb * 1024 * 1024) as usize;
    tracing::info!("HTTP body limit: {} MiB", max_body_mb);

    // Rate limiting — per-client IP (from the peer or X-Forwarded-For
    // if a trusted proxy is upstream).
    //
    // Defaults: period=2s, burst=30 → one token replenished every 2s
    // (= 0.5 req/s sustained) with a 30-token bucket for bursts.
    // Overridable via `RATE_LIMIT_PERIOD_SECONDS` and
    // `RATE_LIMIT_BURST_SIZE`. Use-cases defended:
    //   • brute-force on /auth/oauth2 (callbacks are rare, retries
    //     should never be high-rate)
    //   • scraping on /api/external/search + /api/user/import/*
    //     (cheap to spam, expensive outbound to MAL/MangaDex)
    //   • abuse of /api/user/compare/{slug}/add/{mal_id} (each call
    //     does a DB fetch + optional S3 copy)
    //
    // Master switch: `RATE_LIMIT_ENABLED=false` disables the layer
    // entirely. Intended for local dev + integration tests; in prod
    // leaving it off opens the door to brute-force and outbound
    // amplification. When disabled, we also skip the background
    // cleanup task so there's zero overhead from the feature.
    //
    // Route-specific buckets (e.g. tighter for imports) would be
    // more precise but require `.route_layer`s per route, which we
    // can layer on later if real traffic shows the global default
    // is too loose for specific endpoints.
    let governor_conf = if rate_limit_enabled {
        tracing::info!(
            period_seconds = rate_limit_period_seconds,
            burst_size = rate_limit_burst_size,
            "Rate limiting enabled (per-IP)"
        );
        let conf = Arc::new(
            GovernorConfigBuilder::default()
                .per_second(rate_limit_period_seconds)
                .burst_size(rate_limit_burst_size)
                .finish()
                .expect(
                    "governor config should be valid (period/burst are clamped ≥ 1 in config.rs)",
                ),
        );
        // Background cleanup: periodically evict per-IP state that
        // hasn't been hit recently. Without this, the per-IP map
        // grows unboundedly under scraper load (small leak, but real).
        let governor_limiter_for_cleanup = conf.limiter().clone();
        crate::services::jobs::spawn_supervised("governor_cleanup", async move {
            let interval = std::time::Duration::from_secs(60);
            loop {
                tokio::time::sleep(interval).await;
                governor_limiter_for_cleanup.retain_recent();
            }
        });
        Some(conf)
    } else {
        tracing::warn!(
            "Rate limiting DISABLED via RATE_LIMIT_ENABLED=false. \
             Safe for local dev only; do NOT leave this off in prod — \
             /auth, /api/external/*, and /api/user/import/* become \
             easy brute-force + amplification targets."
        );
        None
    };

    // CSRF guard applies to every state-changing (POST/PUT/PATCH/DELETE)
    // request across /auth and /api. GET/HEAD/OPTIONS always pass, which
    // naturally exempts the only auth route that can't carry an Origin
    // header: the OAuth callback (`GET /auth/oauth2/callback`). The
    // POST /auth/oauth2/logout IS protected, preventing a malicious
    // page from logging the user out.
    let csrf_allowed_origin = Arc::new(frontend_url.clone());
    let csrf_layer = axum::middleware::from_fn({
        let allowed = csrf_allowed_origin.clone();
        move |req, next| csrf_origin_guard(allowed.clone(), req, next)
    });

    let app = Router::new()
        .nest("/auth", routes::auth::auth_router())
        .nest("/api", routes::api::api_router())
        .with_state(state);

    // GovernorLayer is conditional: when rate limiting is disabled
    // (RATE_LIMIT_ENABLED=false) we don't attach it at all, so there's
    // zero per-request overhead and the per-IP state map never gets
    // allocated. Done as a split `let app =` rather than chained so
    // the type unification handled by Router stays trivial.
    // tower_governor 0.8 changed `GovernorLayer` from a struct-literal
    // constructor to `GovernorLayer::new(config)` (also added an
    // optional error-handler builder we don't use yet). The semantics
    // are identical to the previous `{ config }` form.
    let app = match governor_conf {
        Some(conf) => app.layer(GovernorLayer::new(conf)),
        None => app,
    };

    let app = app
        .layer(csrf_layer)
        .layer(axum::extract::DefaultBodyLimit::max(max_body_bytes))
        .layer(session_layer)
        .layer(cors)
        // HTTP trace — noisy 2xx logs are muted at DEBUG, but the
        // request span itself runs at INFO so failure logs carry
        // method/uri context instead of the bare "500 Internal Server
        // Error · latency=…" the default config produces. For the
        // actual error message bubble, see `errors.rs::IntoResponse`
        // which logs at ERROR before the 5xx response is sent.
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(
                    DefaultMakeSpan::new().level(tracing::Level::INFO),
                )
                .on_response(
                    DefaultOnResponse::new().level(tracing::Level::DEBUG),
                )
                .on_failure(
                    DefaultOnFailure::new().level(tracing::Level::ERROR),
                ),
        )
        // ── Security response headers ────────────────────────────────
        // Applied last (outermost in the layer stack → first to run on
        // the response path). Static overrides: individual endpoints
        // can still emit their own Cache-Control/Content-Type, and
        // tower-http's `overriding` constructor keeps those wins.
        //
        //   • X-Content-Type-Options: nosniff — stops browsers
        //     inferring MIME from bytes (defence against our own
        //     Content-Type misconfigurations).
        //   • X-Frame-Options: DENY — blocks iframe embedding =
        //     clickjacking prevention. The SPA is not meant to be
        //     embedded anywhere.
        //   • Referrer-Policy: strict-origin-when-cross-origin — don't
        //     leak full URLs (incl. query strings) to other origins.
        //   • Strict-Transport-Security (HSTS) — only emitted when the
        //     frontend URL is HTTPS, so local dev stays HTTP-friendly.
        .layer(SetResponseHeaderLayer::overriding(
            http::header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            http::header::X_FRAME_OPTIONS,
            // Operator-tunable via `X_FRAME_OPTIONS`. Default "DENY"
            // (see config.rs). We `try_from` here because a
            // misconfigured value (e.g. containing CR/LF) could
            // otherwise panic at runtime via `from_static`. On parse
            // failure we fall back to "DENY" and log, keeping the
            // clickjacking defence engaged.
            HeaderValue::try_from(x_frame_options.as_str()).unwrap_or_else(|err| {
                tracing::warn!(
                    %err,
                    value = %x_frame_options,
                    "X_FRAME_OPTIONS value is not a valid header — falling back to DENY"
                );
                HeaderValue::from_static("DENY")
            }),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            http::header::REFERRER_POLICY,
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ));

    // HSTS only in prod (https). max-age=1 year; includeSubDomains
    // because the API + frontend are commonly on subdomains of the
    // same apex domain. Do NOT enable `preload` without running the
    // submission process at hstspreload.org.
    let app = if frontend_url.starts_with("https://") {
        app.layer(SetResponseHeaderLayer::overriding(
            http::header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        ))
    } else {
        app
    };

    // ── Sentry tower layers ──────────────────────────────────────────────
    // Outermost in the stack so Sentry sees every request — including the
    // ones that get rejected by upstream middleware (governor, csrf,
    // body-limit). When `observability::init` returned `Ok(None)`
    // (neither DSN configured) the layers still attach but the global
    // sentry client is a no-op, so events fall on the floor — the per-
    // request overhead of building the Hub is negligible.
    //
    // Layer order matters:
    //   1. SentryHttpLayer (inner of the two)  — captures HTTP request
    //      data + opens a transaction when traces are enabled.
    //   2. NewSentryLayer (outermost)          — forks a fresh Hub per
    //      request so events/breadcrumbs from concurrent requests don't
    //      bleed into each other. This MUST be the outer of the two so
    //      the Hub exists before SentryHttpLayer runs.
    // `enable_transaction()` is unconditional — whether transactions are
    // actually transmitted is gated by `traces_sample_rate` in the Sentry
    // client options (0.0 by default → built locally then discarded, no
    // network cost). The conditional builder pattern would over-engineer
    // for that single sample-rate flag.
    let app = app
        .layer(sentry_tower::SentryHttpLayer::new().enable_transaction())
        .layer(sentry_tower::NewSentryLayer::new_from_top());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Server running on port {}", port);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    Ok(())
}

/// Drain Ctrl-C and SIGTERM so a `docker stop` / k8s rolling deploy
/// finishes the in-flight requests before the process exits. Without
/// this, axum cuts every connection immediately on signal — including
/// any DB transaction the request was about to commit.
async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(e) = tokio::signal::ctrl_c().await {
            tracing::warn!(error = %e, "ctrl-c handler failed");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(e) => {
                tracing::warn!(error = %e, "SIGTERM handler failed");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
    tracing::info!("shutdown signal received, draining in-flight requests");
}

/// Loopback healthcheck used by `--health`. Hits the running server's
/// `/api/health` endpoint over 127.0.0.1 and mirrors its pass/fail signal as
/// a process exit code.
async fn run_health_check() -> i32 {
    let port = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(3000);
    let url = format!("http://127.0.0.1:{}/api/health", port);

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(_) => return 1,
    };

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => 0,
        _ => 1,
    }
}

/// CSRF defence-in-depth for the `/api` tree.
///
/// SameSite=Lax on the session cookie already blocks the classic CSRF
/// shape (cross-site POST/PATCH/DELETE from an attacker page): modern
/// browsers refuse to attach the cookie. This middleware adds a second
/// gate for older browsers, misconfigured clients, and subdomain
/// takeover scenarios where SameSite doesn't fire.
///
/// The rule for state-changing methods (POST, PUT, PATCH, DELETE) is
/// simple: the `Origin` header MUST match the configured frontend URL.
/// No Origin → reject. Wrong Origin → reject. Matches the pattern OWASP
/// recommends for REST APIs that don't issue explicit CSRF tokens.
///
/// Why NOT apply this to `/auth`: the OAuth callback is a top-level
/// browser navigation from the identity provider. It has no Origin
/// header (same-origin top-level loads don't set one in many browsers,
/// and cross-site top-level loads set it to the IDP, not ours). Forcing
/// a match would break the login flow.
///
/// GET/HEAD/OPTIONS always pass — they should never mutate server
/// state; if they do, that's a separate bug to fix at the route level.
async fn csrf_origin_guard(
    expected_origin: Arc<String>,
    req: Request,
    next: Next,
) -> Response {
    match *req.method() {
        Method::GET | Method::HEAD | Method::OPTIONS => return next.run(req).await,
        _ => {}
    }
    let origin_header = req
        .headers()
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    match origin_header.as_deref() {
        Some(o) if o == expected_origin.as_str() => next.run(req).await,
        other => {
            tracing::warn!(
                method = %req.method(),
                uri = %req.uri(),
                origin = ?other,
                expected = %expected_origin,
                "CSRF guard rejected request (Origin mismatch)"
            );
            (
                StatusCode::FORBIDDEN,
                "CSRF protection: Origin header missing or not allowed",
            )
                .into_response()
        }
    }
}
