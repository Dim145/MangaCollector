ALTER TABLE settings
    ADD COLUMN IF NOT EXISTS "titleType" VARCHAR
        CHECK ("titleType" IN ('Default', 'English', 'Japanese'))
        DEFAULT 'Default';
