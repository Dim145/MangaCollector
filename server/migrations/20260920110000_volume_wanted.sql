-- 飛 · Volumes the reader has decided to skip.
--
-- A collection is not always meant to be complete. Readers deliberately
-- leave out a volume: an artbook counted as a tome, a side story they
-- have no interest in, a double they refuse to buy again in a new
-- edition. Until now the app had no way to hear that — every unowned
-- tome was a hole, counted in the gaps, subtracted from the percentage,
-- and offered back on the dashboard as something to go and find.
--
-- `wanted = false` says "not a hole, a choice". The volume keeps its
-- row, its number and its place in the run; it simply stops being
-- counted as missing.
--
-- Default TRUE: every existing row, and every row created from here on,
-- is wanted until the reader says otherwise.
ALTER TABLE user_volumes
    ADD COLUMN IF NOT EXISTS wanted BOOLEAN NOT NULL DEFAULT TRUE;
