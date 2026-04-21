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
    pub session_secret: String,
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
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        dotenvy::dotenv().ok();

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
            session_secret: std::env::var("SESSION_SECRET")
                .expect("SESSION_SECRET is required"),
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
        })
    }
}
