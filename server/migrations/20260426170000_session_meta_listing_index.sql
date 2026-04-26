-- 機 · Composite index for the active-sessions listing path.
--
-- `services::sessions::list_for_user` filters on `user_id` and orders
-- by `last_seen_at DESC` after a `last_seen_at > NOW() - 30d`
-- pruning. The pre-existing single-column index on `user_id` covers
-- the filter but forces a sort step on top — fine when a user has
-- 3 sessions, slow on a power user with 100+ historical rows that
-- have rolled out of the visibility window but are still touched
-- by the scan before the WHERE filter applies.
--
-- A composite (`user_id`, `last_seen_at DESC`) index covers both
-- the filter and the ordering, returning the rows already sorted —
-- the planner can stop scanning past the 30-day cutoff.
--
-- IF NOT EXISTS keeps the migration idempotent. Re-running it
-- against a database that already has the index is a quiet no-op,
-- not an error — important because this file ships AFTER the
-- previous batch of session-meta migrations and operators may roll
-- it forward independently.

CREATE INDEX IF NOT EXISTS user_session_meta_user_id_last_seen_idx
    ON public.user_session_meta (user_id, last_seen_at DESC);
