-- 作家 Sakka · Author / mangaka column on the library row.
--
-- Pulled from MAL (Jikan `/manga/{id}/full` returns an `authors` array)
-- when the series is added or refreshed. Stored as a free-text
-- "Family Given" (Western order) for consistency with how the SPA
-- already renders names elsewhere — MAL ships "Family, Given" but
-- the rendering layer flips them.
--
-- 120 chars cap fits the longest known credits ("Story by X / Art by Y"
-- for collaborations) without inviting a megabyte paste.
--
-- An index on `author` powers the reverse-lookup `/api/user/authors`
-- endpoint and the per-author detail page. Partial index on
-- `author IS NOT NULL` keeps it lean — most queries filter for
-- "series with a known author".

ALTER TABLE user_libraries
    ADD COLUMN author VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_user_libraries_user_author
    ON user_libraries (user_id, author)
    WHERE author IS NOT NULL;
