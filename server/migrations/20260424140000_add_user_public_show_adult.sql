-- Public profile — adult-content opt-in.
--
-- Orthogonal to the personal `settings.adult_content_level` (which
-- governs what the owner sees in their own dashboard). This column
-- controls what ANONYMOUS visitors see on `/u/{slug}`. FALSE by
-- default so switching on the public profile doesn't silently expose
-- adult-tagged series; the owner must tick a second toggle explicitly.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS public_show_adult BOOLEAN NOT NULL DEFAULT FALSE;
