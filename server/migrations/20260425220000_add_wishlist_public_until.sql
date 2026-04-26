-- 祝 · Birthday mode — temporary public exposure of wishlist entries.
--
-- When set, anonymous visitors of `/u/{slug}` see series the owner is
-- tracking but doesn't yet own (volumes_owned = 0) — useful before a
-- birthday / wedding / housewarming so guests can pick a gift with
-- confidence. Resets back to "wishlist hidden" automatically once the
-- timestamp lapses; the application layer compares against `now()`
-- rather than running a cron, so a stale row never accidentally leaks.
--
-- NULL = feature inactive (the default state); a non-NULL value in
-- the past is treated identically — the UI just nudges the owner to
-- re-arm the toggle if they want it again.
ALTER TABLE users
    ADD COLUMN wishlist_public_until TIMESTAMPTZ;
