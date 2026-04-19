ALTER TABLE settings
    ADD COLUMN IF NOT EXISTS adult_content_level INTEGER NOT NULL DEFAULT 0
        CHECK (adult_content_level BETWEEN 0 AND 2);

-- Databases that were migrated by the old JS/Knex backend already had the
-- legacy boolean column dropped — skip the UPDATE in that case instead of
-- failing with "column does not exist".
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name   = 'settings'
          AND column_name  = 'show-adult-content'
    ) THEN
        UPDATE settings
            SET adult_content_level = CASE WHEN "show-adult-content" = true THEN 2 ELSE 0 END;
    END IF;
END
$$;

ALTER TABLE settings DROP COLUMN IF EXISTS "show-adult-content";
