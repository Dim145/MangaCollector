-- 預ける Azuke · Per-volume loan tracker.
--
-- Adds three columns to user_volumes that together describe the
-- "lent to a friend" state of a single tome:
--
--   • loaned_to        — free-text borrower name (NULL = not lent)
--   • loan_started_at  — when the volume left the shelf
--   • loan_due_at      — expected return date (NULL = open-ended)
--
-- Invariant: `loaned_to IS NULL` iff `loan_started_at IS NULL`. The
-- service layer enforces this; the schema stays permissive (no CHECK)
-- so a future "lent without remembering when" code path doesn't break
-- on a strict constraint. `loan_due_at` is independent — a loan
-- without a due date is the common case ("just take it for now").
--
-- Lent volumes are still `owned = true` from the collector's POV;
-- the loan columns are an overlay, not a replacement of ownership.
-- This matters for the seal-stat aggregator and the public profile,
-- which both keep counting lent tomes as part of the user's library.

ALTER TABLE user_volumes
    ADD COLUMN loaned_to       TEXT,
    ADD COLUMN loan_started_at TIMESTAMPTZ,
    ADD COLUMN loan_due_at     TIMESTAMPTZ;

-- Partial index on currently-lent rows so the dashboard "outstanding
-- loans" widget can list them without scanning the full volume table.
-- Only ~1% of volumes are lent at any time for a typical user; the
-- predicate keeps this index tiny.
CREATE INDEX IF NOT EXISTS idx_user_volumes_loan_active
    ON user_volumes (user_id, loan_due_at)
    WHERE loaned_to IS NOT NULL;
