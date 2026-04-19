-- Convert every TIMESTAMP (naive) column into TIMESTAMPTZ.
-- Existing values were always written as UTC wall-clock, so the conversion
-- `AT TIME ZONE 'UTC'` preserves them byte-for-byte — it just tags them
-- with the right zone. After this migration, the Rust models use
-- `DateTime<Utc>`, serde emits ISO-8601 with `Z` suffix, and browsers stop
-- mis-interpreting the values as local time.

ALTER TABLE users
    ALTER COLUMN created_on TYPE TIMESTAMPTZ USING created_on AT TIME ZONE 'UTC',
    ALTER COLUMN modified_on TYPE TIMESTAMPTZ USING modified_on AT TIME ZONE 'UTC';

ALTER TABLE user_libraries
    ALTER COLUMN created_on TYPE TIMESTAMPTZ USING created_on AT TIME ZONE 'UTC',
    ALTER COLUMN modified_on TYPE TIMESTAMPTZ USING modified_on AT TIME ZONE 'UTC';

ALTER TABLE user_volumes
    ALTER COLUMN created_on TYPE TIMESTAMPTZ USING created_on AT TIME ZONE 'UTC',
    ALTER COLUMN modified_on TYPE TIMESTAMPTZ USING modified_on AT TIME ZONE 'UTC';

ALTER TABLE settings
    ALTER COLUMN created_on TYPE TIMESTAMPTZ USING created_on AT TIME ZONE 'UTC',
    ALTER COLUMN modified_on TYPE TIMESTAMPTZ USING modified_on AT TIME ZONE 'UTC';

ALTER TABLE activity_log
    ALTER COLUMN created_on TYPE TIMESTAMPTZ USING created_on AT TIME ZONE 'UTC';

-- Default on the activity_log column — keep the default as `NOW()`, but
-- that already returns `timestamptz` so no change needed.
