-- 鍵 · Per-user API keys for the MCP endpoint, and the audit trail of
-- what an agent did with one.
--
-- A presented credential is `mcp_<prefix>_<secret>`. Only the prefix is
-- stored in the clear: it is the public half, it is what the listing
-- shows and what the rate limiter buckets on, and it is the indexed
-- lookup that finds the row before any hashing happens. The secret half
-- is stored as a SHA-256 digest and is shown to the user exactly once,
-- at mint time — the same reasoning as `user_session_meta.public_id`,
-- where handing the real credential back to the page undid HttpOnly.
--
-- `scopes` is a comma-separated allow-list (the `user_libraries.genres`
-- convention). There is no wildcard and an empty string grants nothing,
-- so a row that loses its scopes fails closed.
CREATE TABLE IF NOT EXISTS user_api_keys (
    id           TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prefix       TEXT NOT NULL,
    secret_hash  TEXT NOT NULL,
    label        TEXT NOT NULL,
    scopes       TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    -- NULL means "no expiry". A key the user never rotates is the norm
    -- for a self-hosted instance; an expiry is opt-in.
    expires_at   TIMESTAMPTZ
);

-- The authentication lookup. Unique because the prefix is what a
-- presented key resolves to — two rows sharing one would make the
-- lookup ambiguous and the rate-limit bucket shared.
CREATE UNIQUE INDEX IF NOT EXISTS user_api_keys_prefix_idx
    ON user_api_keys(prefix);

-- The listing, newest first.
CREATE INDEX IF NOT EXISTS user_api_keys_user_idx
    ON user_api_keys(user_id, created_at DESC);

-- 記 · One row per MCP tool call, so the owner can see what an agent did
-- on their behalf and an operator can investigate abuse.
--
-- Arguments are recorded as a digest, never verbatim: they carry prices,
-- private notes, borrower names and shelf locations, and this table is
-- read back by the owning user's own UI. The digest is enough to tell
-- "the same call, again" from "a different one", which is what an audit
-- trail is actually asked.
--
-- `api_key_id` goes NULL rather than cascading when a key is revoked:
-- revoking a key must not erase the record of what it did.
CREATE TABLE IF NOT EXISTS mcp_audit_log (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_key_id  TEXT REFERENCES user_api_keys(id) ON DELETE SET NULL,
    at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    tool        TEXT NOT NULL,
    -- 'ok' | 'denied' (scope refused, or confirm missing) | 'error'
    outcome     TEXT NOT NULL,
    duration_ms INTEGER,
    args_digest TEXT,
    detail      TEXT
);

CREATE INDEX IF NOT EXISTS mcp_audit_log_user_idx
    ON mcp_audit_log(user_id, at DESC);
