-- 作家 · Enforce case-insensitive author-name uniqueness per user.
--
-- The free-text author resolver (`resolve_author_from_text`) is a
-- find-or-create: it ILIKE-matches an existing author by name and only
-- mints a new custom row on a miss. There was NO unique constraint
-- backing that, so a race (two offline ops replaying) or any lookup miss
-- the ILIKE didn't catch could mint duplicate custom authors for the
-- same person — and a replayed library edit could leave several
-- "Naoko Takeuchi" rows. This migration deduplicates any existing
-- duplicates, then adds the partial unique index that prevents new ones.
--
-- Scope: custom authors only (`user_id IS NOT NULL`). Shared MAL-sourced
-- rows (`user_id IS NULL`) are already deduped by their own
-- `authors_shared_pk` partial unique index on `mal_id`.

-- 1. Repoint every library row that points at a duplicate custom author
--    onto the survivor (the lowest id per (user_id, lower(name))).
--    user_libraries.author_id is the ONLY foreign key into authors.
WITH dupes AS (
    SELECT id,
           first_value(id) OVER (
               PARTITION BY user_id, lower(name) ORDER BY id
           ) AS survivor_id
    FROM authors
    WHERE user_id IS NOT NULL
)
UPDATE user_libraries ul
SET author_id = d.survivor_id
FROM dupes d
WHERE ul.author_id = d.id
  AND d.id <> d.survivor_id;

-- 2. Delete the now-unreferenced duplicate author rows.
WITH dupes AS (
    SELECT id,
           first_value(id) OVER (
               PARTITION BY user_id, lower(name) ORDER BY id
           ) AS survivor_id
    FROM authors
    WHERE user_id IS NOT NULL
)
DELETE FROM authors a
USING dupes d
WHERE a.id = d.id
  AND d.id <> d.survivor_id;

-- 3. The constraint. Partial (custom rows only) + expression index on
--    lower(name) so "Tezuka" and "tezuka" collide. The resolver's ILIKE
--    lookup keeps reusing the existing row in the common case; this index
--    is the DB-level backstop that turns a racing/duplicate mint into a
--    clean 23505 (mapped to 409 by errors.rs → the client drops the op
--    and reconciles) instead of a silent duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS authors_user_name_ci
    ON authors (user_id, lower(name))
    WHERE user_id IS NOT NULL;
