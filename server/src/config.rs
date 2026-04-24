use std::path::PathBuf;

#[derive(Debug, Clone)]
pub enum AuthMode {
    Google,
    OpenIdConnect,
}

#[derive(Debug, Clone)]
pub enum StorageConfig {
    S3 {
        endpoint: String,
        access_key: String,
        secret_key: String,
        bucket_name: String,
        region: String,
        use_ssl: bool,
        use_path_style: bool,
    },
    Local {
        dir: PathBuf,
    },
}

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub auth_mode: AuthMode,
    pub auth_client_id: String,
    pub auth_client_secret: String,
    pub auth_issuer: String,
    pub auth_name: String,
    pub auth_icon: String,
    /// Reserved. The `PostgresStore` used by tower-sessions generates
    /// cryptographically-random 128-bit session IDs, which already
    /// prevents session guessing. Signing cookies with this secret
    /// (via `SessionManagerLayer::with_signed`) would add HMAC
    /// verification against cookie tampering / fixation but requires
    /// the `tower-sessions/signed` feature + `cookie/key-expansion`
    /// and a ≥32-byte secret. Left optional for now so existing
    /// deployments don't break, and documented as unused to avoid
    /// misleading operators who check their env vars.
    pub session_secret: Option<String>,
    pub frontend_url: String,
    pub postgres_url: String,
    pub storage: StorageConfig,
    pub app_unsecure_healthcheck: bool,
    /// Redis connection URL (e.g. "redis://redis:6379/1"). When unset, the
    /// cache layer is disabled and every external API call hits the network.
    pub redis_url: Option<String>,
    /// Prefix prepended to every cache key (separator included). Lets users
    /// share a Redis DB between multiple apps without namespace collisions.
    pub cache_prefix: String,
    /// Master switch for the per-IP rate limiter. Default `true`.
    /// Set `RATE_LIMIT_ENABLED=false` to disable — intended for local
    /// dev and integration tests; leaving it off in production opens
    /// the door to brute-force on /auth and outbound amplification via
    /// the import endpoints.
    pub rate_limit_enabled: bool,
    /// Number of seconds between token refills in the per-IP rate
    /// limiter. Lower = stricter. Default 2 (one token / 2 seconds =
    /// 0.5 req/s sustained). Must be ≥ 1 (governor refuses zero).
    /// Ignored when `rate_limit_enabled = false`.
    pub rate_limit_period_seconds: u64,
    /// Burst capacity of the per-IP token bucket. Clients can send up
    /// to this many requests in quick succession before being throttled
    /// to the sustained rate. Default 30. Must be ≥ 1.
    pub rate_limit_burst_size: u32,
    /// Value served in the `X-Frame-Options` response header for every
    /// response. Default `DENY` (refuse all iframing). Set to
    /// `SAMEORIGIN` if a first-party subdomain legitimately needs to
    /// embed the app. Deprecated `ALLOW-FROM uri` syntax is still
    /// accepted by the server but not by modern browsers — prefer a
    /// CSP `frame-ancestors` directive if the use case is real.
    pub x_frame_options: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        // `dotenvy::dotenv()` reads `.env` from the current working
        // directory and INJECTS any variables it finds into the
        // process environment, OVERWRITING anything already set. In
        // production containers, a stray `.env` (left in the image,
        // mounted by accident, baked-in by a dev workflow) can
        // silently override the real secrets the operator passed via
        // `docker run -e` / Kubernetes envFrom.
        //
        // Gate on `APP_ENABLE_DOTENV=true` — opt-in, explicit, only
        // honoured when someone actually wants to load a .env file.
        // Local dev sets it via the checked-in `docker-compose.yml`;
        // production images should never set it.
        if std::env::var("APP_ENABLE_DOTENV").ok().as_deref() == Some("true") {
            let _ = dotenvy::dotenv();
        }

        let auth_mode = match std::env::var("AUTH_MODE")
            .unwrap_or_else(|_| "google".to_string())
            .to_lowercase()
            .as_str()
        {
            "google" => AuthMode::Google,
            _ => AuthMode::OpenIdConnect,
        };

        let auth_issuer = match auth_mode {
            AuthMode::Google => "https://accounts.google.com".to_string(),
            AuthMode::OpenIdConnect => std::env::var("AUTH_ISSUER")
                .expect("AUTH_ISSUER is required when AUTH_MODE=openidconnect"),
        };

        // Storage: use S3 if all 4 required vars are set, otherwise local filesystem
        let s3_endpoint = std::env::var("S3_ENDPOINT").ok();
        let s3_access_key = std::env::var("S3_ACCESS_KEY").ok();
        let s3_secret_key = std::env::var("S3_SECRET_KEY").ok();
        let s3_bucket_name = std::env::var("S3_BUCKET_NAME").ok();

        let storage = if let (Some(endpoint), Some(access_key), Some(secret_key), Some(bucket_name)) =
            (s3_endpoint, s3_access_key, s3_secret_key, s3_bucket_name)
        {
            StorageConfig::S3 {
                endpoint,
                access_key,
                secret_key,
                bucket_name,
                region: std::env::var("S3_REGION").unwrap_or_else(|_| "us-east-1".to_string()),
                use_ssl: std::env::var("S3_USE_SSL")
                    .map(|v| v == "true")
                    .unwrap_or(false),
                use_path_style: std::env::var("S3_USE_PATH_STYLE")
                    .map(|v| v == "true")
                    .unwrap_or(false),
            }
        } else {
            StorageConfig::Local {
                dir: std::env::var("STORAGE_DIR")
                    .map(PathBuf::from)
                    .unwrap_or_else(|_| PathBuf::from("./storage")),
            }
        };

        Ok(Config {
            port: std::env::var("PORT")
                .unwrap_or_else(|_| "3000".to_string())
                .parse()
                .expect("PORT must be a valid number"),
            auth_mode,
            auth_client_id: std::env::var("AUTH_CLIENT_ID")
                .expect("AUTH_CLIENT_ID is required"),
            auth_client_secret: std::env::var("AUTH_CLIENT_SECRET")
                .expect("AUTH_CLIENT_SECRET is required"),
            auth_issuer,
            auth_name: std::env::var("AUTH_NAME").unwrap_or_else(|_| "Google".to_string()),
            auth_icon: std::env::var("AUTH_ICON").unwrap_or_else(|_| "google".to_string()),
            session_secret: std::env::var("SESSION_SECRET").ok().filter(|s| !s.is_empty()),
            frontend_url: std::env::var("FRONTEND_URL")
                .expect("FRONTEND_URL is required"),
            postgres_url: std::env::var("POSTGRES_URL")
                .expect("POSTGRES_URL is required"),
            storage,
            app_unsecure_healthcheck: std::env::var("APP_UNSECURE_HEALTHCHECK")
                .map(|v| v == "true")
                .unwrap_or(false),
            redis_url: std::env::var("REDIS_URL").ok().filter(|s| !s.is_empty()),
            cache_prefix: std::env::var("CACHE_PREFIX")
                .unwrap_or_else(|_| "mangacollect/".to_string()),
            // Rate limit knobs — parse + clamp out-of-band values to
            // the documented defaults so a typo doesn't accidentally
            // disable the limiter. Zero is forbidden (governor panics
            // at build time); clamp to 1 as a safety net.
            //
            // `RATE_LIMIT_ENABLED` is the master switch. We accept
            // the canonical boolean literals `true`/`false` (case-
            // insensitive); any unrecognised value falls back to the
            // secure default (enabled) with a log warning emitted at
            // startup in `main.rs`. Missing env var → enabled.
            rate_limit_enabled: std::env::var("RATE_LIMIT_ENABLED")
                .ok()
                .map(|s| !s.eq_ignore_ascii_case("false"))
                .unwrap_or(true),
            rate_limit_period_seconds: std::env::var("RATE_LIMIT_PERIOD_SECONDS")
                .ok()
                .and_then(|s| s.parse::<u64>().ok())
                .map(|n| n.max(1))
                .unwrap_or(2),
            rate_limit_burst_size: std::env::var("RATE_LIMIT_BURST_SIZE")
                .ok()
                .and_then(|s| s.parse::<u32>().ok())
                .map(|n| n.max(1))
                .unwrap_or(30),
            x_frame_options: std::env::var("X_FRAME_OPTIONS")
                .ok()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "DENY".to_string()),
        })
    }
}
