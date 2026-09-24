//! 同期 · WebSocket handler — opens a duplex channel between the
//! client and the backend, then streams `SyncEvent`s filtered to the
//! authenticated user.
//!
//! We only ever WRITE on this socket (the client doesn't need to talk
//! back — it's a pure invalidation notifier). The read half is kept
//! alive only to absorb control frames (pings, close) so Axum's
//! WebSocket state machine stays happy.

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};

use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::IntoResponse,
};
use tokio::sync::Mutex;

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::services::realtime::SyncBroker;
use crate::state::AppState;

/// Server-side ping cadence. Without ping/pong, a client that drops
/// off the network without sending TCP RST (mobile captive portal,
/// suspended laptop) leaves the socket open indefinitely.
const PING_INTERVAL: Duration = Duration::from_secs(30);

/// Maximum tolerated silence after a ping before we consider the
/// peer dead and close the socket.
const PONG_TIMEOUT: Duration = Duration::from_secs(60);

/// 源 · The handshake is a GET, so the CSRF origin guard skips it and
/// only `SameSite=Lax` stands between a foreign page and an open socket.
/// The frame payload is just invalidation signals, but "this account is
/// active, and series N changed" is still the user's business alone.
fn origin_allowed(headers: &axum::http::HeaderMap, expected: &str) -> bool {
    match headers.get(axum::http::header::ORIGIN).and_then(|v| v.to_str().ok()) {
        // A same-origin WebSocket from a non-browser client sends none.
        None => true,
        Some(origin) => {
            origin.trim_end_matches('/') == expected.trim_end_matches('/')
        }
    }
}

/// 量 · The largest frame this socket will read. The server sends
/// events and reads nothing but control frames, so anything bigger is
/// not a client of ours. The default is 64 MiB per message, buffered in
/// full, and the HTTP body limit does not apply to frames: a few dozen
/// sockets each sending one message were enough to run out of memory.
const MAX_INBOUND_FRAME: usize = 4 * 1024;

pub async fn ws_handler(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ClientId(client_id): ClientId,
    session: tower_sessions::Session,
    headers: axum::http::HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    if !origin_allowed(&headers, &state.config.frontend_url) {
        return Err(AppError::Unauthorized);
    }
    // `AuthenticatedUser` has already checked this session; the socket
    // keeps its id so it can check again for as long as it is open.
    let Some(session_id) = session.id().map(|id| id.to_string()) else {
        return Err(AppError::Unauthorized);
    };
    let broker = state.broker.clone();
    let db = state.db.clone();
    let user_id = user.id;
    Ok(ws
        .max_message_size(MAX_INBOUND_FRAME)
        .max_frame_size(MAX_INBOUND_FRAME)
        .on_upgrade(move |socket| {
            handle_socket(socket, broker, db, session_id, user_id, client_id)
        }))
}

/// 機 · Is the session this socket was opened with still allowed?
///
/// The same two checks `AuthenticatedUser` makes on every request: the
/// meta row (deleted on revocation and with the account) and the
/// upstream session's expiry. Checking only at the upgrade meant a
/// revoked laptop's open tab kept receiving the user's events — series
/// ids and timing — for as long as it answered pings. Fails closed: a
/// database error closes the socket, and the client reconnects through
/// the normal authenticated path.
async fn session_still_allowed(db: &crate::db::Db, session_id: &str) -> bool {
    use sea_orm::EntityTrait;
    let meta = crate::models::session_meta::Entity::find_by_id(session_id.to_string())
        .one(db)
        .await
        .map(|row| row.is_some())
        .unwrap_or(false);
    meta && crate::services::sessions_cleanup::upstream_session_alive(db, session_id).await
}

/// 源 · The SPA's per-tab client id, read from `X-Client-Id` (HTTP) or
/// `?client_id=` (the websocket upgrade, where custom headers aren't
/// available from the browser API). Optional everywhere: a missing or
/// malformed value simply means "unknown origin" and the old
/// broadcast-to-everyone behaviour. Validated to a short opaque token
/// so it can never carry anything worth logging or reflecting.
pub struct ClientId(pub Option<String>);

impl ClientId {
    const MAX_LEN: usize = 64;

    fn sanitize(raw: &str) -> Option<String> {
        let ok = (8..=Self::MAX_LEN).contains(&raw.len())
            && raw
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        ok.then(|| raw.to_string())
    }
}

impl<S: Send + Sync> axum::extract::FromRequestParts<S> for ClientId {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        let from_header = parts
            .headers
            .get("x-client-id")
            .and_then(|v| v.to_str().ok())
            .and_then(Self::sanitize);
        let from_query = || {
            parts.uri.query().and_then(|q| {
                q.split('&')
                    .filter_map(|kv| kv.split_once('='))
                    .find(|(k, _)| *k == "client_id")
                    .and_then(|(_, v)| Self::sanitize(v))
            })
        };
        Ok(ClientId(from_header.or_else(from_query)))
    }
}

async fn handle_socket(
    socket: WebSocket,
    broker: SyncBroker,
    db: crate::db::Db,
    session_id: String,
    user_id: i32,
    client_id: Option<String>,
) {
    use futures::{SinkExt, StreamExt};
    let (sender, mut receiver) = socket.split();
    let sender = Arc::new(Mutex::new(sender));
    let mut rx = broker.subscribe();

    // 心拍 · Last instant we received any frame from the client (pong,
    // ping, message). Updated on each inbound; the heartbeat task
    // checks it against PONG_TIMEOUT to detect zombie sockets.
    let last_seen = Arc::new(Mutex::new(Instant::now()));
    let stop = Arc::new(AtomicBool::new(false));

    // Forward-events task: subscribes to the broker and writes the
    // JSON payload of every matching event on the wire.
    let mut send_task = {
        let sender = sender.clone();
        let stop = stop.clone();
        tokio::spawn(async move {
            loop {
                let event = match rx.recv().await {
                    Ok(event) => event,
                    // 遅 · This socket fell behind a burst and missed some
                    // events. Leaving the loop closed the socket, which
                    // is the opposite of what a busy moment needs; what
                    // it missed is repaired by telling the client to
                    // refetch the collection, as an unscoped event does.
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let resync = [
                            crate::services::realtime::SyncKind::Library,
                            crate::services::realtime::SyncKind::Volumes,
                        ];
                        let mut s = sender.lock().await;
                        let mut ok = true;
                        for kind in resync {
                            let event = crate::services::realtime::SyncEvent {
                                user_id,
                                kind,
                                mal_id: None,
                                origin: None,
                            };
                            let Ok(payload) = serde_json::to_string(&event) else {
                                continue;
                            };
                            if s.send(Message::Text(payload.into())).await.is_err() {
                                ok = false;
                                break;
                            }
                        }
                        if !ok {
                            break;
                        }
                        continue;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                };
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                if event.user_id != user_id {
                    continue;
                }
                // 源 · Don't echo a change back to the socket whose own
                // request caused it. That client already holds the
                // optimistic state (and, on the outbox flush path, runs
                // its own post-flush refetch); the echo only triggered a
                // redundant full refetch — and, before the cache writers
                // learned to respect pending outbox rows, it was one of
                // the two triggers that visibly reverted offline edits.
                if client_id.is_some() && event.origin == client_id {
                    continue;
                }
                let payload = match serde_json::to_string(&event) {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                let mut s = sender.lock().await;
                if s.send(Message::Text(payload.into())).await.is_err() {
                    break;
                }
            }
        })
    };

    // Heartbeat task: pings the client periodically, kills the socket
    // when the silence exceeds `PONG_TIMEOUT`.
    let mut ping_task = {
        let sender = sender.clone();
        let last_seen = last_seen.clone();
        let stop = stop.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(PING_INTERVAL);
            interval.tick().await; // skip the immediate first tick
            loop {
                interval.tick().await;
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                let elapsed = last_seen.lock().await.elapsed();
                if elapsed > PONG_TIMEOUT {
                    break;
                }
                if !session_still_allowed(&db, &session_id).await {
                    break;
                }
                let mut s = sender.lock().await;
                if s.send(Message::Ping(Default::default())).await.is_err() {
                    break;
                }
            }
        })
    };

    // Inbound task: drain whatever the client sends. We expect only
    // control frames; anything else is ignored. Each frame refreshes
    // `last_seen` so the heartbeat task knows the peer is alive.
    let mut recv_task = {
        let last_seen = last_seen.clone();
        let stop = stop.clone();
        tokio::spawn(async move {
            while let Some(msg) = receiver.next().await {
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                match msg {
                    Ok(Message::Close(_)) => break,
                    Ok(_) => {
                        *last_seen.lock().await = Instant::now();
                    }
                    Err(_) => break,
                }
            }
        })
    };

    // Either side dying means the socket is no longer useful.
    tokio::select! {
        _ = &mut send_task => {}
        _ = &mut recv_task => {}
        _ = &mut ping_task => {}
    }
    stop.store(true, Ordering::Relaxed);
    // 閉 · End the other two now, and say goodbye. A spawned task is not
    // cancelled when its handle is dropped: the survivors each kept a
    // clone of the sender, so the connection stayed open — a socket
    // whose session had just been revoked, or which had just sent a
    // frame over the limit, lingered until the next ping tick or the
    // next event. Aborting them drops their clones; the close frame
    // tells the client, which reconnects through the authenticated
    // path if it still may.
    send_task.abort();
    recv_task.abort();
    ping_task.abort();
    let _ = sender.lock().await.send(Message::Close(None)).await;
}

#[cfg(test)]
mod client_id_tests {
    use super::ClientId;

    #[test]
    fn accepts_the_shapes_the_spa_generates() {
        // crypto.randomUUID() and the 24-char base36 fallback.
        assert!(ClientId::sanitize("3dd0b814-23f4-4342-b13f-d5f0dd7d4ca6").is_some());
        assert!(ClientId::sanitize("k2j9x0q1mzp4r7t8v5w6y3ab").is_some());
        assert!(ClientId::sanitize("a_b-C_d-1234").is_some());
    }

    #[test]
    fn rejects_too_short_too_long_and_foreign_characters() {
        assert!(ClientId::sanitize("short").is_none());
        assert!(ClientId::sanitize(&"x".repeat(65)).is_none());
        assert!(ClientId::sanitize("has space here").is_none());
        assert!(ClientId::sanitize("<script>alert1").is_none());
        assert!(ClientId::sanitize("émoji-ünïcode-12").is_none());
        assert!(ClientId::sanitize("").is_none());
    }

    #[test]
    fn boundaries_are_inclusive() {
        assert!(ClientId::sanitize(&"a".repeat(8)).is_some());
        assert!(ClientId::sanitize(&"a".repeat(64)).is_some());
        assert!(ClientId::sanitize(&"a".repeat(7)).is_none());
    }
}
