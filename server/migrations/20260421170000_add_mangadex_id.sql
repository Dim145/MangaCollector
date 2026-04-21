-- Optional cross-reference to the MangaDex manga UUID.
-- Populated when:
--  * a library entry is added via the MangaDex search flow (custom entry with
--    pre-filled data), OR
--  * the merged search resolves a MAL entry that MangaDex also knows about
--    (so future refresh-from-mangadex is possible even for MAL-first entries).
-- Left NULL for pure MAL entries we couldn't cross-link, and for custom
-- entries the user created manually.
ALTER TABLE user_libraries ADD COLUMN IF NOT EXISTS mangadex_id VARCHAR;
