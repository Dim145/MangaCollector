ALTER TABLE settings
    ADD COLUMN IF NOT EXISTS sound_enabled BOOLEAN
        NOT NULL
        DEFAULT FALSE;
