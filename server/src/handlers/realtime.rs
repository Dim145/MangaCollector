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

pub async fn ws_handler(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    let broker = state.broker.clone();
    let user_id = user.id;
    Ok(ws.on_upgrade(move |socket| handle_socket(socket, broker, user_id)))
}

async fn handle_socket(socket: WebSocket, broker: SyncBroker, user_id: i32) {
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
    let send_task = {
        let sender = sender.clone();
        let stop = stop.clone();
        tokio::spawn(async move {
            while let Ok(event) = rx.recv().await {
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                if event.user_id != user_id {
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
    let ping_task = {
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
    let recv_task = {
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
        _ = send_task => {}
        _ = recv_task => {}
        _ = ping_task => {}
    }
    stop.store(true, Ordering::Relaxed);
}
