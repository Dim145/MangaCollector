//! 機 · Active-session helpers.
//!
//! tower-sessions stores its own opaque rows in
//! `"tower_sessions"."session"` (the lib-managed schema); we keep a
//! parallel index in `user_session_meta` so the SPA can list and
//! revoke per-user sessions without reverse-engineering the upstream
//! BYTEA encoding.
//!
//! The two tables are deliberately **decoupled**: the FK that bound
//! them was dropped (cf. migration `20260426150000_drop_session_meta_fk.sql`)
//! because tower-sessions cycles its row id on "record-not-found"
//! recovery, which made the FK constraint reject perfectly valid
//! meta inserts under specific race windows. The trade-off is a
//! background cleanup pass that periodically prunes orphaned meta
//! rows (`spawn_session_meta_cleanup` in `main.rs`).

use chrono::Utc;
use chrono::Duration;
use sea_orm::sea_query::OnConflict;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::Instant;

use crate::db::Db;
use crate::errors::AppError;
use crate::models::session_meta::{
    self, ActiveModel, Entity as SessionMetaEntity, SessionInfo,
};

/// Truncate a user-agent at a reasonable cap. Some browsers (and
/// virtually every bot in the wild) send unbounded UA strings; we
/// store at most 256 chars to defang the obvious storage-DoS path.
const UA_MAX_LEN: usize = 256;

/// Drop ASCII control chars + null bytes from a UA before storing it.
/// The audit flagged that the previous code only truncated length —
/// `\r`, `\n`, `\x00`, etc. would round-trip into the DB, then back
/// out via `GET /api/user/sessions`. The SPA happens to render text-
/// only today, but defense-in-depth is cheap and the strings should
/// never have looked like terminal control sequences anyway.
fn sanitize_user_agent(raw: &str) -> String {
    raw.chars()
        .filter(|c| !c.is_control())
        .take(UA_MAX_LEN)
        .collect()
}

/// Insert (or refresh) the per-session metadata for a fresh login.
///
/// Called from the OAuth callback handler ONCE — the first time a
/// session id is bound to a user. ON CONFLICT updates the user_agent
/// + last_seen_at (just in case the same session id is being re-bound
///   to the same user, which can happen if the user re-clicks "sign in"
///   on a stale tab without losing the cookie).
///
/// 印 · `user_id` is **NOT** in the conflict-update column list. The
/// previous version included it, which meant a request hitting
/// `/auth/oauth2/callback` with somebody else's cookie could re-write
/// the meta row's `user_id` and steal the session for a different
/// account (session-fixation). The OAuth callback rotates the
/// session id (`session.cycle_id()`) just before this insert so the
/// "same session id, different user" path is closed at the source —
/// and even if a future regression reopened it, this update column
/// list keeps the meta row's owner immutable on conflict.
///
/// Distinct from `touch` below: this is the **only** path that
/// CREATES a meta row. `touch` is UPDATE-only, so it never resurrects
/// a row that was deleted by `revoke()` or by the logout handler.
/// That asymmetry is exactly what makes revoke stick — a second
/// request from a stale cookie triggers `touch`, which finds nothing
/// to update and quietly no-ops. Without this split, the UPSERT
/// would re-insert the revoked row at the next authenticated hit,
/// erasing the revoke.
///
/// Returns the sqlx error rather than swallowing it: the caller
/// (OAuth callback) needs to fail the login if the meta INSERT
/// didn't land — otherwise the user gets a cookie pointing at no
/// meta row, the gate kicks them on the next request, and the SPA
/// loops back through OAuth indefinitely.
pub async fn record_login(
    db: &Db,
    session_id: &str,
    user_id: i32,
    user_agent: Option<String>,
) -> Result<(), AppError> {
    let now = Utc::now();
    let trimmed_ua = user_agent
        .map(|ua| sanitize_user_agent(ua.trim()))
        .filter(|s| !s.is_empty());

    let model = ActiveModel {
        session_id: Set(session_id.to_string()),
        user_id: Set(user_id),
        user_agent: Set(trimmed_ua.clone()),
        created_at: Set(now),
        last_seen_at: Set(now),
    };
    SessionMetaEntity::insert(model)
        .on_conflict(
            OnConflict::column(session_meta::Column::SessionId)
                // Notably absent: `Column::UserId`. Hardens against
                // session-fixation — a meta row's owner is set
                // exactly once (at INSERT) and never overwritten.
                .update_columns([
                    session_meta::Column::UserAgent,
                    session_meta::Column::LastSeenAt,
                ])
                .to_owned(),
        )
        .exec(db)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

/// 静 · In-memory throttle for `touch`. Without it, every authenticated
/// request would issue a `UPDATE user_session_meta SET last_seen_at = …`,
/// burning DB writes (and WAL pressure) for sub-minute precision the
/// UI doesn't need. The "active sessions" panel rounds to minutes
/// anyway, so a 60-second floor is invisible to humans and removes
/// 99% of the writes for a polling client.
///
/// HashMap behind a Mutex (not RwLock): every access mutates the
/// map, so write-heavy access patterns favour the simpler primitive.
/// Bounded growth: entries are session ids — at most one per active
/// user device, in practice a few thousand rows. We additionally
/// prune stale entries periodically below.
const TOUCH_THROTTLE_SECS: u64 = 60;
fn touch_cache() -> &'static Mutex<HashMap<String, Instant>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Returns `true` if a UPDATE should fire for this session, `false`
/// if the last `touch` was within the throttle window.
fn should_touch_now(session_id: &str) -> bool {
    let mut map = match touch_cache().lock() {
        Ok(g) => g,
        // Poisoned mutex: a previous panic broke the cache. Defensively
        // assume the touch should fire — the DB is still authoritative,
        // we'd just be back to the un-throttled behaviour.
        Err(p) => p.into_inner(),
    };
    let now = Instant::now();

    // Periodic prune so the cache doesn't grow unbounded for users
    // who hit /sessions repeatedly with new cookies. We sweep when
    // the map grows past 512 entries, dropping anything older than
    // 4× the throttle window (any session that hasn't requested in
    // that long is either offline or expired anyway). Bounded work:
    // 512 entries traversed once per growth past the threshold —
    // negligible compared to the DB write we just avoided.
    if map.len() > 512 {
        let cutoff = std::time::Duration::from_secs(TOUCH_THROTTLE_SECS * 4);
        map.retain(|_, t| now.duration_since(*t) < cutoff);
    }

    match map.get(session_id) {
        Some(prev)
            if now.duration_since(*prev).as_secs() < TOUCH_THROTTLE_SECS =>
        {
            false
        }
        _ => {
            map.insert(session_id.to_string(), now);
            true
        }
    }
}

/// UPDATE-only refresh of `last_seen_at`. Called by the
/// `AuthenticatedUser` extractor on every successful request, so the
/// listing reflects activity rather than just login time.
///
/// Throttled to once per `TOUCH_THROTTLE_SECS` per session — see the
/// rationale on `should_touch_now`. The DB write is async and best-
/// effort either way, but skipping the entire round-trip when the
/// last write is fresh enough saves real cycles on hot paths.
///
/// Critical: this MUST NOT insert a row that doesn't exist. If a row
/// is gone (revoked, logged-out, GC'd), the matching cookie is on
/// borrowed time anyway — a missing row should stay missing. An
/// upsert here would resurrect revoked sessions on the very next
/// request, defeating the revoke endpoint.
pub async fn touch(db: &Db, session_id: &str) {
    if !should_touch_now(session_id) {
        return;
    }
    let now = Utc::now();
    let _ = SessionMetaEntity::update_many()
        .col_expr(
            session_meta::Column::LastSeenAt,
            sea_orm::sea_query::Expr::value(now),
        )
        .filter(session_meta::Column::SessionId.eq(session_id))
        .exec(db)
        .await;
}

/// Periodic cleanup of `user_session_meta` rows whose `last_seen_at`
/// pre-dates the staleness window. Run from a background task so the
/// table doesn't grow unbounded now that the FK + ON DELETE CASCADE
/// is gone (cf. the module doc-comment). Returns the row count
/// deleted so the caller can log it.
pub async fn prune_stale_meta(db: &Db) -> Result<u64, AppError> {
    let cutoff = Utc::now() - Duration::days(STALE_AFTER_DAYS * 2);
    let res = SessionMetaEntity::delete_many()
        .filter(session_meta::Column::LastSeenAt.lt(cutoff))
        .exec(db)
        .await
        .map_err(AppError::from)?;
    Ok(res.rows_affected)
}

/// Threshold beyond which a meta row is considered stale and filtered
/// out of the listing. Set to match the tower-sessions cookie inactivity
/// (30 days) — past that window the upstream session has either been
/// GC'd by the store or remains effectively unreachable, so the meta
/// row no longer represents a session the user can act on.
const STALE_AFTER_DAYS: i64 = 30;

/// List the user's active sessions, newest first.
///
/// The original draft INNER-JOIN'd against `tower_sessions` to filter
/// orphans, but tower-sessions in practice cycles its row id on
/// "record-not-found" recovery — meaning the ids in our meta table
/// can diverge from what's actually in `tower_sessions` for a given
/// cookie. The JOIN then masked every legitimate session.
///
/// We rely on `last_seen_at` as the freshness signal instead: a meta
/// row whose owner hasn't authenticated in the past 30 days is
/// invisible to the user. tower-sessions' inactivity-based cookie
/// expiration uses the same window, so a row that's recent enough to
/// show is by definition recent enough to be a real, usable session.
/// The `current_session_id` flag lets the client highlight the row
/// belonging to the request that issued the call.
pub async fn list_for_user(
    db: &Db,
    user_id: i32,
    current_session_id: &str,
) -> Result<Vec<SessionInfo>, AppError> {
    let cutoff = Utc::now() - Duration::days(STALE_AFTER_DAYS);
    let rows = SessionMetaEntity::find()
        .filter(session_meta::Column::UserId.eq(user_id))
        .filter(session_meta::Column::LastSeenAt.gt(cutoff))
        .order_by_desc(session_meta::Column::LastSeenAt)
        .all(db)
        .await
        .map_err(AppError::from)?;

    Ok(rows
        .into_iter()
        .map(|m| SessionInfo {
            device_label: derive_device_label(m.user_agent.as_deref()),
            is_current: m.session_id == current_session_id,
            id: m.session_id,
            created_at: m.created_at,
            last_seen_at: m.last_seen_at,
            // 印 · Drop the raw UA before sending it back. The
            // device_label above ("macOS · Firefox", etc.) is enough
            // for the UI; the full UA is fingerprintable PII (browser
            // version, plugins, OS minor version) that an attacker
            // who compromises a session could use to perfectly
            // imitate the rightful owner's client. Server-side it
            // stays in `user_session_meta.user_agent` for analytics
            // and `derive_device_label` recomputation.
            user_agent: None,
        })
        .collect())
}

/// Best-effort cleanup of the meta row matching `session_id`. Used
/// from the logout handler to keep `user_session_meta` in sync with
/// the tower_sessions delete that fires there. No ownership check —
/// the caller already proved possession of the cookie.
pub async fn delete_meta(db: &Db, session_id: &str) {
    let _ = SessionMetaEntity::delete_by_id(session_id.to_string())
        .exec(db)
        .await;
}

/// Delete the meta row AND the upstream tower_sessions row for the
/// given session id, but only if it belongs to the requesting user.
/// Returns `false` when no row matched (foreign session id, already
/// gone, etc.) — the handler turns that into a 404.
pub async fn revoke(
    db: &Db,
    user_id: i32,
    session_id: &str,
) -> Result<bool, AppError> {
    // Confirm the session belongs to this user before deletion.
    let owns = SessionMetaEntity::find()
        .filter(session_meta::Column::SessionId.eq(session_id))
        .filter(session_meta::Column::UserId.eq(user_id))
        .one(db)
        .await
        .map_err(AppError::from)?
        .is_some();
    if !owns {
        return Ok(false);
    }

    // Deleting the meta row is enough thanks to the FK + ON DELETE
    // CASCADE on tower_sessions(id). Doing it the other way around
    // would also work but couples us to the upstream table name.
    let res = SessionMetaEntity::delete_by_id(session_id.to_string())
        .exec(db)
        .await
        .map_err(AppError::from)?;

    // The tower_sessions row also needs to go so the cookie stops
    // resolving to a valid session immediately. The CASCADE only
    // fires when the *parent* (tower_sessions) is deleted; deleting
    // the child (meta) doesn't propagate upward. Issue a direct
    // sqlx delete on the parent so the actual session disappears.
    crate::services::sessions_cleanup::delete_tower_session(db, session_id)
        .await
        .ok();
    Ok(res.rows_affected > 0)
}

/// Best-effort device label from a user agent. Composes "{os} · {browser}"
/// when both are detectable, falls back to either alone, returns an
/// empty string when neither matches (the client then shows
/// `unknownDevice` and lets the raw UA live in the tooltip).
///
/// The browser detection is intentionally narrow — Brave, Vivaldi,
/// DuckDuckGo and friends typically masquerade as Chrome via UA, so
/// we don't try to identify them server-side; the only honest
/// fingerprint for those is the `navigator.brave` JS API which is
/// out of reach from request headers. We DO catch Firefox forks
/// (Zen, LibreWolf) by their distinct UA tokens when present.
fn derive_device_label(ua: Option<&str>) -> String {
    let Some(ua) = ua else { return String::new() };
    let os = derive_os_label(ua);
    let browser = derive_browser_label(ua);
    match (os, browser) {
        (Some(os), Some(browser)) => format!("{os} · {browser}"),
        (Some(os), None) => os,
        (None, Some(browser)) => browser,
        (None, None) => String::new(),
    }
}

fn derive_os_label(ua: &str) -> Option<String> {
    let s = ua.to_lowercase();
    if s.contains("ipad") {
        Some("iPad".into())
    } else if s.contains("iphone") {
        Some("iPhone".into())
    } else if s.contains("android") {
        Some("Android".into())
    } else if s.contains("macintosh") || s.contains("mac os x") {
        Some("macOS".into())
    } else if s.contains("windows") {
        Some("Windows".into())
    } else if s.contains("cros") || s.contains("chromeos") {
        Some("ChromeOS".into())
    } else if s.contains("linux") {
        Some("Linux".into())
    } else {
        None
    }
}

fn derive_browser_label(ua: &str) -> Option<String> {
    // Order matters — Edge / Opera / Vivaldi all carry "Chrome" in their
    // UA strings, so the more specific markers must be tested first.
    if ua.contains("Edg/") || ua.contains("EdgA/") || ua.contains("EdgiOS/") {
        Some("Edge".into())
    } else if ua.contains("OPR/") || ua.contains("Opera/") {
        Some("Opera".into())
    } else if ua.contains("Vivaldi/") {
        Some("Vivaldi".into())
    } else if ua.contains("DuckDuckGo/") {
        Some("DuckDuckGo".into())
    } else if ua.contains("LibreWolf/") {
        Some("LibreWolf".into())
    } else if ua.contains("Zen/") {
        Some("Zen".into())
    } else if ua.contains("FxiOS/") || ua.contains("Firefox/") {
        // FxiOS = Firefox on iOS (uses Safari/WebKit under the hood
        // but identifies as a Firefox build); Firefox/ is the desktop
        // / Android Gecko UA. Both fold to the same display label.
        Some("Firefox".into())
    } else if ua.contains("CriOS/") || ua.contains("Chrome/") {
        // CriOS = Chrome on iOS; Chrome/ is the desktop / Android UA.
        Some("Chrome".into())
    } else if ua.contains("Safari/") {
        // Bare Safari only after Chrome / FxiOS have been ruled out:
        // every WebKit-based browser on iOS still carries `Safari/`.
        Some("Safari".into())
    } else {
        None
    }
}
