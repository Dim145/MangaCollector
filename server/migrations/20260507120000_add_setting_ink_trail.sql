-- 筆 · Ink-trail cursor toggle.
--
-- Off by default — the brush-trail cursor is an opt-in flourish,
-- not a baseline interaction. The motion is fine-pointer-only and
-- decorative; users on coarse-pointer devices, reduced-motion, or
-- those who simply find the trail distracting should not have to
-- discover it before they can dismiss it.
--
-- Pure visual setting; storage as boolean keeps it lean. Same
-- pattern as `shelf_3d_enabled` and `sound_enabled`.
ALTER TABLE settings
    ADD COLUMN IF NOT EXISTS ink_trail_enabled BOOLEAN
        NOT NULL
        DEFAULT FALSE;
