//! 同期 · Realtime sync broker.
//!
//! Fans out invalidation events to every connected WebSocket so one
//! device's mutations materialise on every other open session of the
//! same user within a few hundred milliseconds.
//!
//! Two backends, one API:
//!   • `SyncBroker::in_memory()` — single-process broadcast via
//!     `tokio::sync::broadcast`. Zero external dependency; everything
//!     the current dev setup needs.
//!   • `SyncBroker::with_redis(url)` — also subscribes to a Redis
//!     pubsub channel and re-broadcasts inbound messages on the same
//!     in-process channel. Scales across multiple backend instances
//!     because every publish reaches the shared channel, every
//!     instance forwards it back to its local sockets.
//!
//! Events are intentionally minimal: a `user_id` + a `kind` tag. No
//! diff payload. Clients invalidate the matching TanStack Query keys
//! and let their usual refetch machinery pull the fresh data. Keeps
//! the protocol immune to evolution — adding fields on DB rows never
//! breaks realtime.

use std::sync::Arc;
use tokio::sync::broadcast;

use serde::{Deserialize, Serialize};

const REDIS_CHANNEL: &str = "mc:sync";
const CHANNEL_BUFFER: usize = 256;

/// Which part of the user's data just changed. Clients map these to
/// TanStack Query keys on their side; the backend stays agnostic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncKind {
    Library,
    Volumes,
    Coffrets,
    Settings,
    Seals,
    Activity,
    /// 作家 · Author CRUD — fires on create/update/delete of a
    /// custom author, on refresh of a shared MAL author, and on
    /// photo upload/delete. Subscribers (AuthorPage) invalidate
    /// the `["author", mal_id]` React Query key + refetch the
    /// Dexie author cache.
    Authors,
    /// 印影 · Snapshot CRUD — fires on capture / delete / image
    /// upload. Subscribers (SnapshotsPage) invalidate the
    /// `["snapshots"]` query key + refresh `db.snapshots`.
    Snapshots,
    /// 友 · Follow graph mutation — fires on follow/unfollow.
    /// Subscribers (FriendsPage, PublicProfile FollowCTA)
    /// invalidate `["friends", "list"]` and the per-slug
    /// `["friends", "check", slug]` keys.
    Friends,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEvent {
    pub user_id: i32,
    pub kind: SyncKind,
    /// 範 · Series the change is scoped to, when the mutation knows it.
    /// Lets a client refresh one series' rows into its local cache
    /// instead of refetching the whole collection on every event —
    /// for a 3000-volume shelf that is the difference between a 40-row
    /// GET and a ~2 MB one. `None` keeps the old "refetch everything"
    /// behaviour; both are handled client-side.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mal_id: Option<i32>,
    /// 源 · Opaque id of the client instance whose request caused the
    /// event (the `X-Client-Id` header). The websocket handler uses it
    /// to skip echoing an event back to the socket that produced it:
    /// that client already holds the optimistic state and, for the
    /// outbox flush path, runs its own post-flush refetch. `None` for
    /// background jobs and for clients that don't send the header.
    ///
    /// Both fields are `serde(default)` so an instance on the previous
    /// build can still decode events relayed through Redis during a
    /// rolling deploy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
}

/// Broker shared in `AppState`. Cheap to clone (every field behind an
/// Arc or by value Copy).
#[derive(Clone)]
pub struct SyncBroker {
    tx: broadcast::Sender<SyncEvent>,
    redis_publisher: Option<Arc<redis::Client>>,
}

impl SyncBroker {
    /// Local-only broker — mutations fan out across the same process's
    /// sockets, nothing crosses machine boundaries.
    pub fn in_memory() -> Self {
        let (tx, _) = broadcast::channel(CHANNEL_BUFFER);
        Self { tx, redis_publisher: None }
    }

    /// Redis-backed broker. Tries to connect; on failure logs a
    /// warning and falls back to in-memory only (so dev without
    /// Redis still gets realtime locally).
    pub async fn with_redis(url: &str) -> Self {
        let client = match redis::Client::open(url) {
            Ok(c) => Arc::new(c),
            Err(err) => {
                tracing::warn!(
                    %err,
                    "realtime: Redis URL invalid, falling back to in-memory broker"
                );
                return Self::in_memory();
            }
        };

        let (tx, _) = broadcast::channel(CHANNEL_BUFFER);
        let broker = Self {
            tx: tx.clone(),
            redis_publisher: Some(Arc::clone(&client)),
        };

        // Spawn the pubsub listener. It runs for the lifetime of the
        // process and reconnects on error with a small backoff.
        let client_for_task = Arc::clone(&client);
        tokio::spawn(async move {
            loop {
                match run_pubsub_loop(&client_for_task, &tx).await {
                    Ok(()) => {
                        tracing::warn!(
                            "realtime: pubsub loop exited cleanly, restarting"
                        );
                    }
                    Err(err) => {
                        tracing::warn!(%err, "realtime: pubsub loop failed, retrying in 2s");
                    }
                }
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        });

        broker
    }

    /// Publish an event. When Redis is wired, we only send through
    /// Redis and let the pubsub listener echo it back to our local
    /// channel — that keeps the fan-out path single-origin and avoids
    /// duplicate delivery. Falls back to direct in-memory send when
    /// Redis is absent or momentarily unreachable.
    pub async fn publish(&self, user_id: i32, kind: SyncKind) {
        self.publish_scoped(user_id, kind, None, None).await;
    }

    /// `publish` with the optional scope (`mal_id`) and originating
    /// client id. Handlers that know both should use this; the plain
    /// form is for background jobs and mutations without a series.
    pub async fn publish_scoped(
        &self,
        user_id: i32,
        kind: SyncKind,
        mal_id: Option<i32>,
        origin: Option<String>,
    ) {
        let event = SyncEvent {
            user_id,
            kind,
            mal_id,
            origin,
        };

        if let Some(client) = &self.redis_publisher {
            // Try Redis first. On any error, fall through to the
            // in-memory path so a transient Redis blip doesn't starve
            // locally-connected clients.
            let payload = match serde_json::to_string(&event) {
                Ok(s) => s,
                Err(_) => return,
            };
            let res: Result<(), redis::RedisError> = async {
                let mut conn = client.get_multiplexed_async_connection().await?;
                redis::AsyncCommands::publish::<_, _, ()>(&mut conn, REDIS_CHANNEL, &payload).await?;
                Ok(())
            }
            .await;
            if let Err(err) = res {
                tracing::debug!(
                    %err,
                    "realtime: redis publish failed, using in-memory fallback"
                );
                let _ = self.tx.send(event);
            }
            // Success path: the pubsub listener will re-deliver via tx.
        } else {
            // In-memory only — publish directly. Send returns Err
            // when no receivers exist, which is fine: nothing to do.
            let _ = self.tx.send(event);
        }
    }

    /// Subscribe for all events. Consumers filter by `user_id` on
    /// their end (the broker is intentionally user-agnostic so the
    /// subscriber set stays O(1) regardless of user count).
    pub fn subscribe(&self) -> broadcast::Receiver<SyncEvent> {
        self.tx.subscribe()
    }
}

/// Body of the Redis listener task. Returns when the pubsub connection
/// drops so the outer retry loop can back off and reconnect.
async fn run_pubsub_loop(
    client: &redis::Client,
    tx: &broadcast::Sender<SyncEvent>,
) -> Result<(), redis::RedisError> {
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(REDIS_CHANNEL).await?;
    tracing::info!("realtime: subscribed to Redis channel '{}'", REDIS_CHANNEL);

    use futures::StreamExt;
    let mut stream = pubsub.on_message();
    while let Some(msg) = stream.next().await {
        let payload: String = match msg.get_payload() {
            Ok(p) => p,
            Err(_) => continue,
        };
        match serde_json::from_str::<SyncEvent>(&payload) {
            Ok(event) => {
                // Sender::send returns Err when no receivers — that's a
                // normal transient state (no-one's watching right now).
                let _ = tx.send(event);
            }
            Err(err) => {
                tracing::debug!(%err, "realtime: ignoring malformed pubsub payload");
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod wire_tests {
    use super::*;

    #[test]
    fn scoped_event_serialises_both_optional_fields() {
        let ev = SyncEvent {
            user_id: 7,
            kind: SyncKind::Volumes,
            mal_id: Some(42),
            origin: Some("tab-aaaaaaaa".into()),
        };
        let v: serde_json::Value = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["user_id"], 7);
        assert_eq!(v["kind"], "volumes");
        assert_eq!(v["mal_id"], 42);
        assert_eq!(v["origin"], "tab-aaaaaaaa");
    }

    #[test]
    fn unscoped_event_omits_the_optional_fields_entirely() {
        // Older clients (and the browser hook's `Number.isInteger` check)
        // must see the exact pre-change shape, not explicit nulls.
        let ev = SyncEvent {
            user_id: 7,
            kind: SyncKind::Library,
            mal_id: None,
            origin: None,
        };
        let v: serde_json::Value = serde_json::to_value(&ev).unwrap();
        assert!(v.get("mal_id").is_none());
        assert!(v.get("origin").is_none());
        assert_eq!(v.as_object().unwrap().len(), 2);
    }

    #[test]
    fn old_shape_still_decodes_during_a_rolling_deploy() {
        // An instance on the previous build relays `{user_id, kind}` over
        // Redis; this build must accept it and read the scope as absent.
        let ev: SyncEvent =
            serde_json::from_str(r#"{"user_id":3,"kind":"seals"}"#).unwrap();
        assert_eq!(ev.user_id, 3);
        assert_eq!(ev.kind, SyncKind::Seals);
        assert_eq!(ev.mal_id, None);
        assert_eq!(ev.origin, None);
    }

    #[test]
    fn negative_custom_series_ids_survive_the_round_trip() {
        let ev = SyncEvent {
            user_id: 1,
            kind: SyncKind::Library,
            mal_id: Some(-12),
            origin: None,
        };
        let json = serde_json::to_string(&ev).unwrap();
        let back: SyncEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(back.mal_id, Some(-12));
    }
}
