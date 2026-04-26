-- 機 · Drop the FK on tower_sessions(id).
--
-- The original constraint kept user_session_meta in lockstep with
-- tower_sessions via ON DELETE CASCADE. In practice this opened a
-- race window: tower-sessions doesn't always have its row flushed at
-- the moment our extractor first writes the meta row (the upstream
-- store schedules its writes from the response middleware, our
-- meta-write fires inside the request handler).
--
-- The FK isn't load-bearing for correctness — we INNER JOIN against
-- tower_sessions at listing time, so an orphan meta row never gets
-- shown. Dropping the constraint lets the upsert succeed even when
-- the tower_sessions row hasn't been committed yet, and the next
-- listing call naturally filters out any orphans (alongside expired
-- sessions).
ALTER TABLE user_session_meta
    DROP CONSTRAINT IF EXISTS user_session_meta_session_id_fkey;
