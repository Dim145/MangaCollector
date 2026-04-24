-- 積読 (tsundoku) — the reading-status axis, orthogonal to ownership.
--
-- `read_at` is the first-read timestamp (NULL = never read). Combined
-- with `owned`, this gives four states per volume:
--   owned=false, read_at=null   → not acquired
--   owned=true,  read_at=null   → tsundoku (owned but unread)
--   owned=true,  read_at=set    → owned + read
--   owned=false, read_at=set    → read elsewhere (borrowed / library)
--
-- The timestamp lets us later surface "just finished" streaks or a
-- reading-cadence chart without adding another column. Nullable so
-- existing rows keep their current meaning (all pre-existing volumes
-- are considered unread until the user marks them).
ALTER TABLE user_volumes
    ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ NULL;

-- Partial index on (user_id) where read_at IS NULL filters the common
-- "tsundoku count" query cheaply: the majority of volumes are likely
-- read over time, so a full index is wasteful; this one stays lean.
CREATE INDEX IF NOT EXISTS user_volumes_unread_idx
    ON user_volumes(user_id)
    WHERE read_at IS NULL AND owned = TRUE;
