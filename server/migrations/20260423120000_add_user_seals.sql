-- 印鑑帳 — Le carnet de sceaux
--
-- Records which ceremonial seals (achievements) a user has earned.
-- The seal catalog lives in Rust (`services/seals.rs`) and is keyed by a
-- stable seal_code; inserts are idempotent (composite PK prevents dupes).
-- `earned_at` preserves the moment the seal was granted so the UI can
-- display "obtained on {date}" and order the carnet by recency if needed.
CREATE TABLE IF NOT EXISTS user_seals (
    user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seal_code   TEXT        NOT NULL,
    earned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, seal_code)
);

CREATE INDEX IF NOT EXISTS user_seals_user_idx ON user_seals(user_id);
