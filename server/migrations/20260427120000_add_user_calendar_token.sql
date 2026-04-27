-- 暦 · Per-user secret token for the subscribable upcoming-calendar
-- ICS feed.
--
-- The feed at `/api/calendar/{token}.ics` is public — Apple Calendar
-- / Google Calendar / Outlook need to fetch it without our session
-- cookie — so the token *is* the authentication. We mint a UUID
-- v4 (122 bits of entropy) lazily on the first GET to
-- `/api/user/calendar/ics-url`, and let the user regenerate it from
-- the SPA whenever they suspect leakage.
--
-- Nullable + UNIQUE: most users never enable the feed, so the
-- column stays NULL until they opt in. UNIQUE keeps the public
-- handler's lookup deterministic (no risk of two users colliding
-- on a generated UUID, vanishingly unlikely but cheap to enforce).
--
-- Idempotent: re-running the migration on a partially-applied DB
-- is a quiet no-op rather than a hard failure.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS calendar_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_calendar_token_uniq
    ON users (calendar_token)
    WHERE calendar_token IS NOT NULL;
