-- 作家 Sakka · Normalise authors via FK.
--
-- Replaces the duplicated author info on every library row
-- (author TEXT + author_mal_id INT) with a single FK reference to
-- `authors.id`. The text column was redundant with `authors.name`,
-- and `author_mal_id` was a soft FK that didn't enforce integrity.
--
-- Migration is idempotent on data:
--   1. Add `author_id` column.
--   2. Link rows where `author_mal_id > 0` to the shared MAL row.
--   3. Link rows where `author_mal_id < 0` to the user's custom row.
--   4. Auto-create custom authors for orphan `author` text (rows that
--      had a typed name but no MAL link) and link them.
--   5. Drop the old columns + their indexes.
-- After migration, every library row that had ANY author signal is
-- linked to a real authors row (shared or custom). Rows with no
-- author at all stay NULL.

-- 1. New FK column. ON DELETE SET NULL preserves the library row when
-- the author is removed from the catalogue (mirror of the unlink
-- semantics in the delete_author service).
ALTER TABLE user_libraries
    ADD COLUMN author_id INTEGER REFERENCES authors(id) ON DELETE SET NULL;

-- 2. Shared MAL author backfill. The shared rows live in `authors`
-- with user_id IS NULL.
UPDATE user_libraries ul
SET author_id = a.id
FROM authors a
WHERE ul.author_mal_id IS NOT NULL
  AND ul.author_mal_id > 0
  AND a.user_id IS NULL
  AND a.mal_id = ul.author_mal_id;

-- 3. Custom (per-user) author backfill. Custom rows have user_id set
-- and negative mal_id.
UPDATE user_libraries ul
SET author_id = a.id
FROM authors a
WHERE ul.author_mal_id IS NOT NULL
  AND ul.author_mal_id < 0
  AND a.user_id = ul.user_id
  AND a.mal_id = ul.author_mal_id;

-- 4. Orphan-text backfill: rows that had `author` typed but no
-- `author_mal_id` (custom-typed name pre-FK era). Auto-create a
-- custom authors row per (user_id, distinct trimmed name) so the
-- typed names survive as proper authors.
WITH orphans AS (
    SELECT DISTINCT user_id, TRIM(author) AS name
    FROM user_libraries
    WHERE author_id IS NULL
      AND author IS NOT NULL
      AND TRIM(author) <> ''
),
existing_min AS (
    SELECT user_id, MIN(mal_id) AS min_mal_id
    FROM authors
    WHERE user_id IS NOT NULL AND mal_id < 0
    GROUP BY user_id
),
to_insert AS (
    SELECT
        o.user_id,
        -- Mint negative mal_ids per user, starting one below the
        -- user's current floor (or -1 when no customs yet). The row
        -- number is per-user and ordered by name for determinism so
        -- a re-run of the migration on identical data produces
        -- identical mal_id assignments.
        COALESCE(em.min_mal_id, 0)
            - ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.name)
            AS new_mal_id,
        o.name
    FROM orphans o
    LEFT JOIN existing_min em ON em.user_id = o.user_id
)
INSERT INTO authors (user_id, mal_id, name, favorites, fetched_at)
SELECT user_id, new_mal_id, name, 0, NOW()
FROM to_insert
ON CONFLICT DO NOTHING;

-- 5. Link the user_libraries rows to the freshly-inserted custom rows
-- via case-insensitive name match scoped to the user.
UPDATE user_libraries ul
SET author_id = a.id
FROM authors a
WHERE ul.author_id IS NULL
  AND ul.author IS NOT NULL
  AND TRIM(ul.author) <> ''
  AND a.user_id = ul.user_id
  AND a.user_id IS NOT NULL
  AND LOWER(TRIM(a.name)) = LOWER(TRIM(ul.author));

-- 6. Drop the old columns + their dependent index.
DROP INDEX IF EXISTS idx_user_libraries_user_author_mal;
ALTER TABLE user_libraries DROP COLUMN author_mal_id;
ALTER TABLE user_libraries DROP COLUMN author;

-- 7. Index for the new FK on the per-user lookup path. Partial so
-- rows without an author don't bloat the index.
CREATE INDEX IF NOT EXISTS idx_user_libraries_user_author_id
    ON user_libraries (user_id, author_id)
    WHERE author_id IS NOT NULL;
