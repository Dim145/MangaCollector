-- 朱 · User-customisable accent colour.
--
-- Stores one of a curated set of palette names (validated by the
-- service layer — see services/settings.rs::VALID_ACCENT_COLORS).
-- NULL = "default" → the frontend keeps the hanko red baseline,
-- which means existing users see no visual change after the
-- migration runs.
--
-- We store the NAME (e.g. 'kin') rather than a raw hex / OKLCH
-- value because:
--   1. The frontend's design system needs a coherent set of derived
--      tones (-deep, -bright, -glow) per accent. Storing the name
--      lets us swap the entire family in one go via a CSS class on
--      <html>.
--   2. Free-form colour input would let users pick values that
--      clash with the hard-baked text/background contrast budget;
--      a curated set guarantees AA contrast across the whole UI.
ALTER TABLE settings
    ADD COLUMN IF NOT EXISTS accent_color VARCHAR(20)
        CHECK (
            accent_color IS NULL
            OR accent_color IN ('shu', 'kin', 'moegi', 'sakura', 'ai', 'kuro', 'murasaki', 'akane')
        )
        DEFAULT NULL;
