-- 作家 Sakka · Owner-scoped author rows.
--
-- Extends the previously shared `authors` cache so users can also
-- create CUSTOM author entries (negative mal_ids, with their own
-- name / photo / bio) alongside the MAL-sourced shared rows.
--
-- Semantic split:
--   user_id IS NULL  → SHARED MAL author cache (positive mal_id).
--                      Read-only from a user's perspective; populated
--                      by the cache-aside fetcher in services/author.
--   user_id = X      → CUSTOM author owned by user X (mal_id < 0).
--                      Editable + deletable by that user.
--
-- The PK can't be `mal_id` alone (custom mal_id=-1 would clash across
-- users) and can't be `(user_id, mal_id)` with a NULL-user-id row
-- (postgres treats NULL as distinct, so two `(NULL, 1880)` rows would
-- both be allowed by a UNIQUE constraint — wrong for the shared cache).
-- We add a synthetic auto-increment `id` PK and enforce identity via
-- two partial unique indexes:
--   • (mal_id) WHERE user_id IS NULL — at most one shared row per mal_id
--   • (user_id, mal_id) WHERE user_id IS NOT NULL — at most one row per (user, mal_id)

ALTER TABLE authors
    ADD COLUMN id SERIAL,
    ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE authors DROP CONSTRAINT authors_pkey;
ALTER TABLE authors ADD PRIMARY KEY (id);

CREATE UNIQUE INDEX authors_shared_pk
    ON authors (mal_id)
    WHERE user_id IS NULL;

CREATE UNIQUE INDEX authors_user_pk
    ON authors (user_id, mal_id)
    WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_authors_user_lower_name
    ON authors (user_id, lower(name));
