-- 代 · A surrogate id for the session list.
--
-- `user_session_meta.session_id` is the same string tower-sessions puts
-- in the cookie, so returning it from `GET /api/user/sessions` handed
-- any script running in the page a live, HttpOnly-bypassing credential
-- for every device the user is signed in on. The listing now returns
-- this surrogate instead, and revocation resolves it server-side.
--
-- Existing rows get one generated in place; `gen_random_uuid()` is core
-- since PostgreSQL 13.
ALTER TABLE user_session_meta
    ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT gen_random_uuid()::text;

CREATE UNIQUE INDEX IF NOT EXISTS user_session_meta_public_id_idx
    ON user_session_meta(public_id);
