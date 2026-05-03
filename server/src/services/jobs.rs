//! Long-running background tasks the server spawns at boot.
//!
//! Three tasks live here:
//!   • `prune_session_meta_loop` — every 6 h, evicts orphan session
//!     metadata rows older than 60 days.
//!   • `nightly_upcoming_sweep` — every 24 h, walks every distinct
//!     followed series and fans the discovery cascade out to each
//!     user that owns it.
//!   • `governor_cleanup_loop` — every 60 s, evicts stale per-IP
//!     rate-limit buckets so the in-memory map can't grow unbounded.
//!
//! The pattern is the same for all three: an infinite `loop { sleep;
//! tick }` spawned via `spawn_supervised` so an unexpected panic at
//! least surfaces in the logs instead of silently zombifying the
//! task.

use std::sync::Arc;
use std::time::Duration;

use crate::config::Config;
use crate::db::Db;
use crate::services::cache::CacheStore;
use crate::services::realtime::{SyncBroker, SyncKind};

/// Spawn a future with panic supervision. A panic in `task` is
/// caught and logged at ERROR level so an operator at least notices
/// the loop went silent — the default behaviour swallows it.
pub fn spawn_supervised<F>(name: &'static str, task: F)
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    tokio::spawn(async move {
        let handle = tokio::spawn(task);
        match handle.await {
            Ok(()) => {
                tracing::info!(task = name, "background task exited normally");
            }
            Err(err) if err.is_panic() => {
                tracing::error!(task = name, %err, "background task PANICKED");
            }
            Err(err) => {
                tracing::warn!(task = name, %err, "background task cancelled");
            }
        }
    });
}

/// Stale session-meta sweeper. Runs every 6 h and deletes rows whose
/// `last_seen_at` is older than 60 days.
pub async fn prune_session_meta_loop(db: Db) {
    let interval = Duration::from_secs(60 * 60 * 6);
    loop {
        tokio::time::sleep(interval).await;
        match crate::services::sessions::prune_stale_meta(&db).await {
            Ok(0) => {}
            Ok(n) => tracing::info!(rows = n, "session_meta cleanup"),
            Err(err) => tracing::warn!(%err, "session_meta cleanup failed"),
        }
    }
}

/// Nightly upcoming-volume sweep.
///
/// Walks every distinct series present in any user's library and
/// runs the discovery cascade. Each user owning the series gets a
/// per-user reconcile + a Volumes WS event when the diff is non-empty.
///
/// Two design choices to flag:
///   1. We sleep ~330 ms between series so MangaUpdates'
///      ~5 req/s rate limit stays comfortable. A library of 1 000
///      distinct series → ~5.5 minutes per pass — fine for a
///      nightly job.
///   2. Errors per series are logged at DEBUG and the loop carries
///      on. A single bad title shouldn't poison the rest of the
///      nightly run.
pub async fn nightly_upcoming_sweep(
    db: Db,
    http: reqwest::Client,
    cache: Option<Arc<CacheStore>>,
    broker: SyncBroker,
    config: Arc<Config>,
) {
    // Boot delay so a rolling deploy doesn't fan every replica out
    // to upstream APIs at the same instant.
    tokio::time::sleep(Duration::from_secs(30 * 60)).await;
    let interval = Duration::from_secs(24 * 3600);
    let inter_series = Duration::from_millis(330);

    loop {
        let started = std::time::Instant::now();
        let mut total_added: u64 = 0;
        let mut total_updated: u64 = 0;
        let mut total_purged: u64 = 0;
        let mut series_processed: u64 = 0;
        let mut errors: u64 = 0;

        // 廃 · Cancellation cleanup — must run first so the rest of
        // the sweep doesn't reincarnate rows the publisher silently
        // dropped. Manual rows are sticky.
        match crate::services::releases::purge_cancelled_upcoming(&db).await {
            Ok(n) => total_purged = n,
            Err(err) => tracing::warn!(%err, "purge_cancelled_upcoming failed"),
        }

        let series = match crate::services::releases::distinct_followed_series(&db).await {
            Ok(s) => s,
            Err(err) => {
                tracing::warn!(%err, "nightly sweep: distinct_followed_series failed");
                tokio::time::sleep(interval).await;
                continue;
            }
        };

        for (mal_id, name) in series {
            series_processed += 1;
            let highest =
                crate::services::releases::highest_known_vol_num_globally(&db, mal_id)
                    .await
                    .unwrap_or(0);
            let start_vol = highest.saturating_add(1);

            let discovered = match crate::services::releases::discover_upcoming_with_locale(
                &http,
                cache.as_deref(),
                config.google_books_api_key.as_deref(),
                &name,
                start_vol,
                "en",
                mal_id,
                config.external_proxy_url.as_deref(),
                Duration::from_secs(config.external_proxy_timeout_secs),
            )
            .await
            {
                Ok(d) => d,
                Err(err) => {
                    errors += 1;
                    tracing::debug!(%err, mal_id, name, "discover_upcoming failed");
                    tokio::time::sleep(inter_series).await;
                    continue;
                }
            };

            if discovered.is_empty() {
                tokio::time::sleep(inter_series).await;
                continue;
            }

            // Fan out per user.
            let users =
                match crate::services::releases::user_ids_owning_series(&db, mal_id).await {
                    Ok(u) => u,
                    Err(err) => {
                        errors += 1;
                        tracing::debug!(%err, mal_id, "user_ids_owning_series failed");
                        tokio::time::sleep(inter_series).await;
                        continue;
                    }
                };

            for uid in users {
                match crate::services::releases::reconcile_user(&db, uid, mal_id, &discovered).await
                {
                    Ok(report) => {
                        let added = report.added.len() as u64;
                        let updated = report.updated.len() as u64;
                        total_added += added;
                        total_updated += updated;
                        if added + updated > 0 {
                            broker.publish(uid, SyncKind::Volumes).await;
                        }
                    }
                    Err(err) => {
                        errors += 1;
                        tracing::debug!(%err, mal_id, uid, "reconcile_user failed");
                    }
                }
            }

            tokio::time::sleep(inter_series).await;
        }

        tracing::info!(
            series = series_processed,
            added = total_added,
            updated = total_updated,
            purged = total_purged,
            errors,
            elapsed_ms = started.elapsed().as_millis() as u64,
            "nightly upcoming sweep finished"
        );

        tokio::time::sleep(interval).await;
    }
}
