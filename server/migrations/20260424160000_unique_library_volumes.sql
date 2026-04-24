-- Add uniqueness guarantees on (user_id, mal_id) for user_libraries
-- and (user_id, mal_id, vol_num) for user_volumes.
--
-- Without these, two concurrent "add custom entry" requests both read
-- the same MIN(mal_id) and mint the same new negative id, producing
-- duplicate library rows. Re-importing a bundle doubles every series
-- row (no idempotent upsert). Seeing two library entries for the same
-- MAL id breaks every downstream query that assumes uniqueness
-- (compare, public profile, cover resolution).
--
-- Partial unique indexes are used because `mal_id` is nullable and
-- NULLs are not considered equal by UNIQUE constraints (a.k.a. "three
-- NULLs don't conflict"). Legacy rows with mal_id=NULL are left
-- unconstrained by design.

-- ── STEP 1 — deduplicate existing data ──────────────────────────────
-- Keep the OLDEST row per (user_id, mal_id) on the library side.
-- created_on ties are broken by `id ASC` to keep the decision
-- deterministic across re-runs of the migration.
DELETE FROM user_libraries
WHERE id IN (
    SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY user_id, mal_id
                   ORDER BY created_on ASC, id ASC
               ) AS rn
        FROM user_libraries
        WHERE mal_id IS NOT NULL
    ) AS ranked
    WHERE rn > 1
);

-- Same idea for user_volumes: keep the oldest per (user_id, mal_id,
-- vol_num). For this table it's more common to have accidental
-- duplicates from imports replayed on flaky networks.
DELETE FROM user_volumes
WHERE id IN (
    SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY user_id, mal_id, vol_num
                   ORDER BY created_on ASC, id ASC
               ) AS rn
        FROM user_volumes
        WHERE mal_id IS NOT NULL
    ) AS ranked
    WHERE rn > 1
);

-- ── STEP 2 — create the uniqueness guards ───────────────────────────
-- `CREATE UNIQUE INDEX IF NOT EXISTS` keeps the migration idempotent
-- (re-runnable without "relation already exists" noise). The `WHERE
-- mal_id IS NOT NULL` clause makes it a partial index, consistent
-- with the "NULL means unknown, don't enforce" policy.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_libraries_user_mal
    ON user_libraries (user_id, mal_id)
    WHERE mal_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_volumes_user_mal_vol
    ON user_volumes (user_id, mal_id, vol_num)
    WHERE mal_id IS NOT NULL;
