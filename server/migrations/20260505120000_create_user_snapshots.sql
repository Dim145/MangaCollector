-- 印影 Inei · Snapshot history.
--
-- A user_snapshots row is a frozen-in-amber state of the user's
-- library at a point in time. The columns are denormalised stats
-- (total_volumes, series_count, etc.) computed once at capture time
-- so the gallery can render rich timeline cards without recomputing
-- against the live library on every render.
--
-- The actual rendered image (1080×1350 PNG produced by
-- `client/src/lib/shelfSnapshot.js`) is stored in S3 / MinIO under
-- a per-user namespace. The `image_path` column carries the storage
-- key — NULL means the snapshot is stats-only (no rendered shelf
-- attached, e.g. the user uploaded one but the image step failed).
-- Photo size cap + magic-byte validation is enforced by the handler.

CREATE TABLE IF NOT EXISTS user_snapshots (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Free-text label ("Spring 2026", "Before the Glénat purge"…).
    -- Capped at SNAPSHOT_NAME_MAX_LEN by the service.
    name TEXT NOT NULL,
    -- Optional notes — what the user was thinking when they captured
    -- this state. Capped at SNAPSHOT_NOTES_MAX_LEN.
    notes TEXT,

    -- Stats at capture time. NULL/0 are valid for empty libraries.
    total_volumes INTEGER NOT NULL DEFAULT 0,
    total_owned INTEGER NOT NULL DEFAULT 0,
    series_count INTEGER NOT NULL DEFAULT 0,
    series_complete INTEGER NOT NULL DEFAULT 0,

    -- Storage key for the rendered shelf PNG. NULL = no image yet.
    image_path TEXT,

    taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-user reverse-chronological listing path. The DESC order on
-- taken_at makes the gallery's default "newest first" sort an
-- index-only scan.
CREATE INDEX IF NOT EXISTS idx_user_snapshots_user_taken
    ON user_snapshots (user_id, taken_at DESC);
