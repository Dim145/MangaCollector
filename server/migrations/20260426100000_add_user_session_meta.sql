-- 機 · Per-user session metadata.
--
-- `tower_sessions` (managed by tower-sessions-sqlx-store) stores raw
-- session blobs keyed by id and doesn't expose the user behind a given
-- session — its `data` column is an opaque BYTEA produced by rmp_serde
-- inside the library. Rather than reverse-engineer that format we keep
-- a parallel index here that the application alone owns.
--
-- ON DELETE CASCADE on the session id ties the meta row's lifetime to
-- the upstream session: when tower-sessions garbage-collects an
-- expired entry OR our `revoke` endpoint deletes it, the meta row
-- disappears in the same transaction. The user_id cascade ensures
-- account erasure (GDPR delete) wipes the session list too.
--
-- We deliberately don't store the IP address: it adds privacy
-- footprint without buying us a useful affordance for an end-user-
-- facing "your devices" list.
CREATE TABLE IF NOT EXISTS user_session_meta (
    session_id   TEXT PRIMARY KEY
                 REFERENCES tower_sessions(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL
                 REFERENCES users(id) ON DELETE CASCADE,
    user_agent   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index on user_id so the per-user listing endpoint stays cheap as a
-- user accumulates revoked / expired sessions over time.
CREATE INDEX IF NOT EXISTS user_session_meta_user_idx
    ON user_session_meta(user_id);
