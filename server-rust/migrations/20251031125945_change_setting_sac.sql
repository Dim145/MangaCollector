ALTER TABLE settings
    ADD COLUMN IF NOT EXISTS adult_content_level INTEGER NOT NULL DEFAULT 0
        CHECK (adult_content_level BETWEEN 0 AND 2);

UPDATE settings
    SET adult_content_level = CASE WHEN "show-adult-content" = true THEN 2 ELSE 0 END;

ALTER TABLE settings DROP COLUMN IF EXISTS "show-adult-content";
