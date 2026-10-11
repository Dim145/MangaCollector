-- 差 · A revision on every volume row, for the client's delta refresh.
--
-- The SPA keeps every volume of the reader in IndexedDB and used to
-- re-read all of them — a megabyte of JSON on a seeded shelf, parsed on
-- the page — whenever any one changed on another device. With a revision
-- per row it asks for what changed since the last one it saw
-- (`GET /api/user/volume?since=<rev>`) plus the ids that still exist,
-- which is how it learns about deletions.
--
-- Why a counter per reader and not a sequence: a sequence hands out
-- numbers at the start of a transaction and they commit in any order,
-- so a reader polling between two commits could move its cursor past a
-- number whose row was not visible yet — and never see that row. Here
-- the trigger takes its number by updating the reader's own counter row
-- in the same transaction as the volume write; the row lock that takes
-- serialises one reader's volume writes, so a revision a reader can see
-- is never followed by a smaller one committing later. Other readers
-- are not affected — each has their own counter row.
--
-- Existing rows start at 0, and so does every counter: a device that
-- holds the full list and asks for `since=0` gets the rows written after
-- this migration, which is exactly what it is missing.
CREATE TABLE IF NOT EXISTS user_volume_revs (
    user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    rev BIGINT NOT NULL DEFAULT 0
);

ALTER TABLE user_volumes
    ADD COLUMN IF NOT EXISTS sync_rev BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION user_volumes_stamp_rev() RETURNS trigger AS $$
BEGIN
    INSERT INTO user_volume_revs (user_id, rev)
    VALUES (NEW.user_id, 1)
    ON CONFLICT (user_id) DO UPDATE SET rev = user_volume_revs.rev + 1
    RETURNING rev INTO NEW.sync_rev;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_volumes_stamp_rev ON user_volumes;
CREATE TRIGGER user_volumes_stamp_rev
    BEFORE INSERT OR UPDATE ON user_volumes
    FOR EACH ROW EXECUTE FUNCTION user_volumes_stamp_rev();

CREATE INDEX IF NOT EXISTS user_volumes_user_sync_rev_idx
    ON user_volumes (user_id, sync_rev);
