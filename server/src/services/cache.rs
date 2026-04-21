use std::time::Duration;

use deadpool_redis::{Config, Pool, Runtime};
use redis::AsyncCommands;
use serde::{Serialize, de::DeserializeOwned};

/// Thin wrapper around a Redis connection pool used as a best-effort cache
/// for outbound API calls (MAL / MangaDex).
///
/// Every operation **fails silently**: if Redis is unreachable, slow, or
/// returns garbage, the caller transparently falls through to the underlying
/// data source. The cache is an accelerator, never the source of truth.
///
/// Keys are namespaced with `prefix` (configured via `CACHE_PREFIX`, default
/// `mangacollect/`) so the same Redis instance can be shared across apps.
pub struct CacheStore {
    pool: Pool,
    prefix: String,
}

impl CacheStore {
    /// Connect to Redis. Fails early only if the URL is syntactically
    /// invalid — actual connectivity is lazy (first pool.get() attempts it).
    pub fn connect(url: &str, prefix: impl Into<String>) -> anyhow::Result<Self> {
        let cfg = Config::from_url(url);
        let pool = cfg
            .create_pool(Some(Runtime::Tokio1))
            .map_err(|e| anyhow::anyhow!("Failed to build Redis pool: {e}"))?;
        Ok(Self {
            pool,
            prefix: prefix.into(),
        })
    }

    /// Prefix the key so different apps / environments don't clash in the
    /// same Redis DB.
    fn key(&self, raw: &str) -> String {
        format!("{}{}", self.prefix, raw)
    }

    /// Best-effort GET. Returns `None` on cache miss, deserialization error,
    /// or any Redis-side failure.
    ///
    /// Note on distinguishing "miss" vs "known-absent":
    /// - Miss: no key in Redis → returns `None`
    /// - Known-absent: key exists with JSON `null` → returns `Some(None)`
    ///   when `T = Option<U>`, because serde sees `null` as `None`.
    /// This lets callers negatively-cache "series not on MangaDex" without
    /// repeatedly hitting the external API.
    pub async fn get<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        let mut conn = self.pool.get().await.ok()?;
        let bytes: Option<Vec<u8>> = conn.get(self.key(key)).await.ok()?;
        let raw = bytes?;
        if raw.is_empty() {
            return None;
        }
        serde_json::from_slice(&raw).ok()
    }

    /// Best-effort SET with TTL. Silently drops when Redis is unreachable or
    /// serialization fails — the caller already has the value to return.
    pub async fn set<T: Serialize>(&self, key: &str, value: &T, ttl: Duration) {
        let Ok(mut conn) = self.pool.get().await else {
            tracing::debug!(key, "cache: Redis pool unavailable, skipping SET");
            return;
        };
        let Ok(bytes) = serde_json::to_vec(value) else {
            tracing::warn!(key, "cache: failed to serialize value");
            return;
        };
        let ttl_secs = ttl.as_secs();
        let res: redis::RedisResult<()> = conn.set_ex(self.key(key), bytes, ttl_secs).await;
        if let Err(e) = res {
            tracing::debug!(key, error = %e, "cache: SET failed");
        }
    }

    /// Ping the server on startup so the operator sees one clear log line
    /// instead of first-request-is-slow surprises in production.
    pub async fn ping(&self) -> anyhow::Result<()> {
        let mut conn = self
            .pool
            .get()
            .await
            .map_err(|e| anyhow::anyhow!("Redis pool unavailable: {e}"))?;
        let _: String = redis::cmd("PING")
            .query_async(&mut *conn)
            .await
            .map_err(|e| anyhow::anyhow!("Redis PING failed: {e}"))?;
        Ok(())
    }
}
