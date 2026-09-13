-- 読 · Reading progression on the series row.
--
-- Per-volume `read_at` already says WHICH tomes were read; these columns
-- say where the reader stands with the series as a whole: a status they
-- can set by hand (planned / reading / paused / completed / dropped),
-- the day they started and the day they finished, and how many times
-- they have read it through. The server keeps status and dates in step
-- with the volume rows on every read/unread flip; the user can override
-- them at any time.
ALTER TABLE user_libraries
    ADD COLUMN IF NOT EXISTS reading_status TEXT NULL,
    ADD COLUMN IF NOT EXISTS started_reading_at DATE NULL,
    ADD COLUMN IF NOT EXISTS finished_reading_at DATE NULL,
    ADD COLUMN IF NOT EXISTS times_read INTEGER NOT NULL DEFAULT 0;

ALTER TABLE user_libraries
    DROP CONSTRAINT IF EXISTS user_libraries_reading_status_check;
ALTER TABLE user_libraries
    ADD CONSTRAINT user_libraries_reading_status_check
    CHECK (reading_status IS NULL
        OR reading_status IN ('planned', 'reading', 'paused', 'completed', 'dropped'));

-- Backfill from the volume rows so existing libraries land with an
-- honest state instead of "never started" everywhere.
WITH agg AS (
    SELECT l.id,
           l.volumes,
           COUNT(v.read_at)       AS read_count,
           MIN(v.read_at)::date   AS first_read,
           MAX(v.read_at)::date   AS last_read
    FROM user_libraries l
    JOIN user_volumes v ON v.user_id = l.user_id AND v.mal_id = l.mal_id
    GROUP BY l.id, l.volumes
)
UPDATE user_libraries l
SET reading_status = CASE
        WHEN a.read_count > 0 AND l.volumes > 0 AND a.read_count >= l.volumes THEN 'completed'
        WHEN a.read_count > 0 THEN 'reading'
        ELSE NULL
    END,
    started_reading_at = CASE WHEN a.read_count > 0 THEN a.first_read END,
    finished_reading_at = CASE
        WHEN a.read_count > 0 AND l.volumes > 0 AND a.read_count >= l.volumes THEN a.last_read
    END
FROM agg a
WHERE a.id = l.id AND l.reading_status IS NULL;
