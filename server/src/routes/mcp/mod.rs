//! 接 · The MCP endpoint (`/mcp`) — a Model Context Protocol server over
//! Streamable HTTP, so an AI client can read and curate one account's
//! manga collection.
//!
//! ## Shape
//!
//! ```text
//! POST /mcp ──▶ require_enabled ──▶ governor (per address) ──▶ authenticate
//!                                                                    │
//!                                                  governor (per verified key)
//!                                                                    │
//!                                                     rmcp StreamableHttpService
//!                                                                    │
//!                                                              McMcp tools
//! ```
//!
//! Mounted at the **top level**, not under `/api`, and merged *after*
//! the CSRF layer rather than inside it. Both matter:
//!
//! * `csrf_origin_guard` in `main.rs` rejects any state-changing request
//!   without a matching `Origin` header. MCP clients are not browsers
//!   and send none, so every tool call would 403 from inside that
//!   layer.
//! * Skipping the guard is safe here precisely because this endpoint
//!   **accepts no cookie**. CSRF is an attack on ambient authority; a
//!   bearer credential the browser will not attach on its own has none
//!   to abuse.
//!
//! The trade-off is one more route in the reverse proxies, which only
//! forward `/api` and `/auth` by default — see `docker-compose.yml` and
//! `client/nginx.conf`.
//!
//! ## Authentication
//!
//! Per-user API keys (`services::api_keys`), presented as
//! `Authorization: Bearer mcp_…`. This deviates from the specification's
//! OAuth 2.1 profile, which is a SHOULD for HTTP transports —
//! authorization itself is OPTIONAL. The consequence is worth stating
//! plainly: clients that let you set a header (Claude Code, Claude
//! Desktop, Cursor, VS Code) work; clients that only do OAuth discovery,
//! such as claude.ai web connectors, do not.

pub mod ctx;
pub mod dto;
pub mod guard;
pub mod prompts;
pub mod server;
pub mod tools_read;
pub mod tools_write;

use std::sync::Arc;

use axum::{Json, Router, http::StatusCode, routing::get};
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::never::NeverSessionManager,
};
use tower_governor::{GovernorLayer, governor::GovernorConfigBuilder};

use crate::state::AppState;

/// MCP payloads are small — a JSON-RPC envelope plus arguments. Anything
/// near this is a mistake or an attack, and rejecting it early costs
/// nothing; the cap is enforced while streaming the body, independent of
/// any `Content-Length` the caller claims.
const MAX_BODY_BYTES: usize = 1024 * 1024;

/// Where the endpoint lives. Documented, and what the settings page puts
/// in the ready-made `claude mcp add` command.
pub const PATH: &str = "/mcp";

/// How much looser the per-IP backstop is than the per-key bucket.
///
/// The two limiters answer different questions. The per-key one is
/// about fairness — one credential's retry loop must not throttle
/// another's — and is sized for a single agent. The per-IP one is
/// about load, and has to leave room for several legitimate agents
/// behind one address while still bounding a prober who rotates
/// prefixes. Six is that room: a NAT would need six busy agents to
/// reach it, a prober reaches it in a second.
const IP_BACKSTOP_FACTOR: u32 = 6;

/// The `/mcp` router: the rmcp transport wrapped in the kill-switch, the
/// per-key limiter and API-key authentication.
pub fn router(state: AppState) -> Router<AppState> {
    // `StreamableHttpServerConfig` is `#[non_exhaustive]`, so build from
    // its default and override deliberately — which also documents what
    // we chose to leave alone.
    let mut config = StreamableHttpServerConfig::default();
    // No protocol-level sessions. The 2026-07-28 revision removed them
    // outright, and for older clients we would rather stay stateless
    // than hold per-connection state we do not need.
    config.legacy_session_mode = false;
    // Prefer a single JSON response; rmcp falls back to SSE by itself if
    // a handler emits a notification before the final result.
    config.json_response = true;
    // Left off deliberately: clients that negotiated below 2026-07-28 do
    // not attach per-request protocol metadata, and requiring it would
    // reject every client in the field today.
    config.stateless_protocol_metadata_required = false;
    // rmcp validates `Host` to block DNS rebinding, and ships accepting
    // loopback only. **Assigning** the list would replace those
    // defaults, which silently breaks local dev, container health
    // checks and any in-network call — so extend it instead. Without the
    // deployment's own authority in here, every production request is
    // refused with "Host header is not allowed".
    //
    // Matching semantics (rmcp's `host_is_allowed`): an entry without a
    // port matches any port; an entry with one must match exactly.
    for host in &state.config.mcp.allowed_hosts {
        if !config.allowed_hosts.contains(host) {
            config.allowed_hosts.push(host.clone());
        }
    }
    config.allowed_origins = state.config.mcp.allowed_origins.clone();
    config.max_request_body_bytes = MAX_BODY_BYTES;

    tracing::info!(
        hosts = ?config.allowed_hosts,
        origins = ?config.allowed_origins,
        "MCP endpoint mounted at /mcp"
    );

    let mcp_state = state.clone();
    let service = StreamableHttpService::new(
        move || Ok(server::McMcp::new(mcp_state.clone())),
        Arc::new(NeverSessionManager::default()),
        config,
    );

    // `.layer()` wraps what it is called on, so the LAST one applied is
    // the OUTERMOST. Built inside-out here, a request sees:
    //
    //   require_enabled → governor(address) → authenticate → governor(key) → transport
    //
    // That order is deliberate. The kill-switch is first because a
    // disabled feature should cost a config read and nothing else. The
    // address limiter sits ahead of authentication so a flood of bad
    // credentials is shed before it can spend a key lookup each. The
    // key limiter sits *behind* it, keyed on the verified key id: ahead
    // of it, it trusted the public prefix, and anyone who had seen a
    // prefix could drain its owner's budget — see `guard::ApiKeyBucket`.
    // The absolute path, not `/` + a nest: this router is `merge`d into
    // the top-level one (see `main.rs`), which prefixes nothing.
    let mut mcp = Router::new().route_service(PATH, service);

    let expect_valid = "valid MCP governor configuration (both knobs clamped ≥ 1 in config.rs)";

    // Evict limiter state that has not been hit recently. Without it the
    // per-key and per-address maps grow for as long as the process lives.
    // A macro rather than a function because the bounds would name
    // `governor`, which is only a transitive dependency; `main.rs`
    // sidesteps it the same way.
    macro_rules! with_cleanup {
        ($name:literal, $conf:expr) => {{
            let conf = Arc::new($conf);
            let limiter = conf.limiter().clone();
            crate::services::jobs::spawn_supervised($name, async move {
                let interval = std::time::Duration::from_secs(60);
                loop {
                    tokio::time::sleep(interval).await;
                    limiter.retain_recent();
                }
            });
            conf
        }};
    }

    if state.config.rate_limit_enabled {
        // ── Per key, behind authentication ───────────────────────
        // Fairness: each credential gets its own budget, so several
        // clients behind one NAT do not share one and a single agent's
        // retry loop cannot throttle the rest. Keyed on the verified key
        // id, so only the key's holder can spend it.
        let per_key = with_cleanup!(
            "mcp_governor_key_cleanup",
            GovernorConfigBuilder::default()
                .per_second(state.config.mcp.rate_limit_per_second)
                .burst_size(state.config.mcp.rate_limit_burst)
                .key_extractor(guard::ApiKeyBucket)
                .finish()
                .expect(expect_valid)
        );
        mcp = mcp.layer(GovernorLayer::new(per_key));
    }

    // Authentication wraps the key limiter (so the limiter sees a
    // verified principal) and sits inside the address limiter below.
    mcp = mcp.layer(axum::middleware::from_fn_with_state(
        state.clone(),
        guard::authenticate,
    ));

    if state.config.rate_limit_enabled {
        // ── Per address, ahead of authentication ─────────────────
        // 抜 · What sheds a flood of bad credentials before each one
        // costs a key lookup: the source address is the one thing a
        // caller cannot choose. (The key's prefix, which the per-key
        // bucket used to trust, is theirs to rotate.)
        //
        // Which extractor is correct depends on the deployment and the
        // two are harmful in each other's, exactly as in `main.rs` —
        // `TRUST_PROXY_HEADERS` decides.
        let ip_burst = state
            .config
            .mcp
            .rate_limit_burst
            .saturating_mul(IP_BACKSTOP_FACTOR);
        mcp = if state.config.trust_proxy_headers {
            let conf = with_cleanup!(
                "mcp_governor_ip_cleanup",
                GovernorConfigBuilder::default()
                    .per_second(state.config.mcp.rate_limit_per_second)
                    .burst_size(ip_burst)
                    .key_extractor(crate::client_ip::TrustedProxyKeyExtractor {
                        hops: state.config.trust_proxy_hops,
                    })
                    .finish()
                    .expect(expect_valid)
            );
            mcp.layer(GovernorLayer::new(conf))
        } else {
            let conf = with_cleanup!(
                "mcp_governor_ip_cleanup",
                GovernorConfigBuilder::default()
                    .per_second(state.config.mcp.rate_limit_per_second)
                    .burst_size(ip_burst)
                    .key_extractor(crate::client_ip::PeerKeyExtractor)
                    .finish()
                    .expect(expect_valid)
            );
            mcp.layer(GovernorLayer::new(conf))
        };
    }

    mcp.layer(axum::middleware::from_fn_with_state(
        state,
        guard::require_enabled,
    ))
}

/// `GET /.well-known/oauth-protected-resource` — RFC 9728 metadata.
///
/// The specification makes this a MUST for a protected MCP server, and
/// serving it is what turns an opaque 401 into something a client can
/// explain to its user.
///
/// Deliberately **without** `authorization_servers`: that field is
/// optional in RFC 9728, and omitting it is how a client learns there is
/// no OAuth flow to attempt here — a statically issued API key is what
/// is wanted.
pub fn well_known_router() -> Router<AppState> {
    Router::new().route(
        guard::RESOURCE_METADATA_PATH,
        get(protected_resource_metadata),
    )
}

async fn protected_resource_metadata(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> (StatusCode, Json<serde_json::Value>) {
    let origin = state.config.frontend_url.trim_end_matches('/');
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "resource": format!("{origin}/mcp"),
            "bearer_methods_supported": ["header"],
            "resource_name": "MangaCollector MCP",
            "scopes_supported": crate::services::api_keys::Scope::READ_ONLY
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>(),
        })),
    )
}
