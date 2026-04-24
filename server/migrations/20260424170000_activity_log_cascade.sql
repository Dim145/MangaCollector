-- activity_log.user_id was created WITHOUT a foreign key to users.id
-- (migration 20260419160000_add_activity_log.sql). `delete_account`
-- explicitly cleans it up inside a transaction, but any future path
-- that removes a user outside that transaction (future admin tool,
-- manual DB ops, failure mid-transaction in delete_account) would
-- leave orphan activity rows referencing a non-existent user.
--
-- This migration retro-adds the FK + ON DELETE CASCADE. Orphan rows,
-- if any, are deleted first so the constraint can attach.

DELETE FROM activity_log
WHERE user_id NOT IN (SELECT id FROM users);

-- `DO $$ ... $$` so we can skip gracefully if the constraint already
-- exists (migration idempotency for ops who manually apply this).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'activity_log'
          AND constraint_name = 'fk_activity_log_user'
    ) THEN
        ALTER TABLE activity_log
            ADD CONSTRAINT fk_activity_log_user
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END
$$;
