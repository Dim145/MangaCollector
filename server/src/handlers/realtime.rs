//! 同期 · WebSocket handler — opens a duplex channel between the
//! client and the backend, then streams `SyncEvent`s filtered to the
//! authenticated user.
//!
//! We only ever WRITE on this socket (the client doesn't need to talk
//! back — it's a pure invalidation notifier). The read half is kept
//! alive only to absorb control frames (pings, close) so Axum's
//! WebSocket state machine stays happy.

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::services::realtime::SyncBroker;
use crate::state::AppState;

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
    let (mut sender, mut receiver) = socket.split();
    let mut rx = broker.subscribe();

    // Forward-events task: subscribes to the broker and writes the
    // JSON payload of every matching event on the wire.
    let send_task = tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            if event.user_id != user_id {
                continue;
            }
            let payload = match serde_json::to_string(&event) {
                Ok(s) => s,
                Err(_) => continue,
            };
            if sender.send(Message::Text(payload.into())).await.is_err() {
                break;
            }
        }
    });

    // Inbound task: drain whatever the client sends. We expect only
    // control frames; anything else is ignored. The task ends on close
    // or first inbound error, which signals the client went away.
    let recv_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            match msg {
                Ok(Message::Close(_)) => break,
                Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => continue,
                Ok(_) => continue, // ignore stray text/binary
                Err(_) => break,
            }
        }
    });

    // Either side dying means the socket is no longer useful.
    tokio::select! {
        _ = send_task => {}
        _ = recv_task => {}
    }
}
