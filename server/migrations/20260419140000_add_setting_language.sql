ALTER TABLE settings
    ADD COLUMN IF NOT EXISTS language VARCHAR
        CHECK (language IN ('en', 'fr', 'es'))
        DEFAULT 'en';
