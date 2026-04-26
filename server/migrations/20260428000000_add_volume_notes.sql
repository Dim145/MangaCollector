-- 記 · Per-volume personal note.
--
-- A free-text field a collector uses to jot a thought, a quote, the
-- circumstances of acquisition, or a private rating. The cap is enforced
-- server-side at 2000 characters in the application layer; we don't push
-- that constraint into the schema because (a) it's a UX cap, not a
-- correctness invariant, and (b) future relaxations shouldn't require a
-- migration. NULL means "no note" — distinct from an empty string we
-- normalise away on insert/update.
ALTER TABLE user_volumes
    ADD COLUMN IF NOT EXISTS notes TEXT NULL;
