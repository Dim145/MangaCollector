-- 棚 · 3D shelf view toggle.
--
-- Off by default — the flat grid stays the canonical Dashboard
-- layout. When ON, each Manga card gains a perspective transform +
-- per-card tilt + wood-grain shadow line under each row, turning
-- the dashboard into a "browse the shelf" experience.
--
-- Pure visual setting; storage as boolean keeps it lean. Same
-- pattern as `sound_enabled`.
ALTER TABLE settings
    ADD COLUMN IF NOT EXISTS shelf_3d_enabled BOOLEAN
        NOT NULL
        DEFAULT FALSE;
