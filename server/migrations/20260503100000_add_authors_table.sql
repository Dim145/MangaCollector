-- 作家 Sakka · Author detail cache.
--
-- The `authors` table is a SHARED cache (not per-user) of MAL/Jikan
-- author metadata. Multiple users can collect series by Sui Ishida —
-- we should fetch his bio + photo once, not once per user.
--
-- Population pattern: cache-aside.
--   1. Library row carries `author_mal_id` (set during MAL refresh)
--   2. Author page hits GET /api/authors/{malId}
--   3. Service checks `authors` table; returns immediately if fresh
--   4. Otherwise: fetches /people/{id}/full from Jikan, upserts row
--   5. Stale rows (>7d) revalidate in background on next access
--
-- The `fetched_at` column drives the freshness check. No FK from
-- user_libraries → authors because:
--   • The author_mal_id may exist on a library row before we've
--     populated the authors table (MAL fetch races library write).
--   • A user could clear the cache (DELETE FROM authors) without
--     wanting to nuke every library row.
-- The link is therefore "soft" — an INTEGER reference enforced only
-- at the application layer.

CREATE TABLE authors (
    mal_id INTEGER PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    given_name VARCHAR(80),
    family_name VARCHAR(80),
    image_url TEXT,
    about TEXT,
    -- Birthday on MAL is a DATETIME with year/month/day; we keep the
    -- full timestamp so `1965-04-12T00:00:00Z` displays meaningfully
    -- without a separate date-only path. NULL for living-author
    -- entries who keep their birthday private (a non-trivial cohort).
    birthday TIMESTAMPTZ,
    favorites INTEGER NOT NULL DEFAULT 0,
    mal_url TEXT,
    -- Last successful Jikan fetch. Drives the staleness check in the
    -- service layer (>7d → background revalidate, but serve cached
    -- copy immediately so the page never blocks on Jikan).
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_authors_name ON authors (lower(name));

-- Soft link from each library row to its primary author. NULL means
-- "we haven't extracted the author from MAL yet" (custom rows, or
-- entries added before this column existed). Backfilled lazily on
-- the next MAL refresh per series.
ALTER TABLE user_libraries
    ADD COLUMN author_mal_id INTEGER;

CREATE INDEX idx_user_libraries_user_author_mal
    ON user_libraries (user_id, author_mal_id)
    WHERE author_mal_id IS NOT NULL;
