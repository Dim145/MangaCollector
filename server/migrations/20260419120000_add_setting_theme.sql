ALTER TABLE settings
    ADD COLUMN IF NOT EXISTS theme VARCHAR
        CHECK (theme IN ('dark', 'light', 'auto'))
        DEFAULT 'dark';
