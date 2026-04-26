-- 来 · Upcoming-volume support.
--
-- Extends `user_volumes` with the metadata an announced-but-not-yet-
-- released tome carries. The presence of a non-NULL `release_date`
-- in the future is the *only* predicate the rest of the codebase
-- uses to flip a row into "upcoming" mode — we deliberately don't
-- mint a separate boolean / status enum. Tomorrow's tome becomes
-- today's missing volume the second the timestamp passes, no async
-- transition required.
--
-- Columns:
--   release_date   — when the publisher announced the tome will hit
--                    shelves. NULL = released or unknown.
--   release_isbn   — ISBN-13 of the announced edition (helps the
--                    eventual scan-on-pickup flow find the row
--                    instead of creating a new one).
--   release_url    — pre-order link (publisher / Amazon / FNAC).
--   origin         — provenance of the row, used to decide whether
--                    the nightly sweep is allowed to overwrite it.
--                    'manual' is sticky: the user typed it in, the
--                    sweep must NOT clobber their date / ISBN. Any
--                    of 'mangaupdates' / 'googlebooks' / 'openlibrary'
--                    / 'mangadex' marks an API-discovered row that
--                    the sweep can refresh in place.
--   announced_at   — when WE first persisted this announcement —
--                    surfaced in the UI as "Detected MMM dd" so the
--                    user knows the freshness of the source.
--
-- Idempotent: re-running this migration on a partially-applied DB
-- is a quiet no-op rather than a hard failure.
ALTER TABLE user_volumes
    ADD COLUMN IF NOT EXISTS release_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS release_isbn TEXT,
    ADD COLUMN IF NOT EXISTS release_url  TEXT,
    ADD COLUMN IF NOT EXISTS origin       TEXT NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS announced_at TIMESTAMPTZ;

-- 探 · Partial index for the calendar / "upcoming-only" query path.
-- Excludes every row whose release_date is NULL — typically 99% of
-- the table — so the index stays small and writes on regular volume
-- mutations don't pay an unrelated maintenance cost.
CREATE INDEX IF NOT EXISTS user_volumes_upcoming_idx
    ON user_volumes (user_id, release_date)
    WHERE release_date IS NOT NULL;
