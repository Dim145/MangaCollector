-- 友 · Loans linked to a friend.
--
-- `loaned_to` stays the free-text borrower handle every loan carries.
-- When the borrower is someone the lender follows, `loaned_to_user_id`
-- points at their account so the loan shows on both sides: the lender's
-- "manifest of absences" links to the friend's profile, and the friend
-- sees the volume under "borrowed from friends".
-- ON DELETE SET NULL: a deleted account leaves the text handle behind;
-- the loan itself is untouched.
ALTER TABLE user_volumes
    ADD COLUMN IF NOT EXISTS loaned_to_user_id INTEGER NULL
        REFERENCES users(id) ON DELETE SET NULL;

-- The borrower-side listing filters on this column alone; a partial
-- index keeps the (vast) unlent majority free of charge.
CREATE INDEX IF NOT EXISTS user_volumes_loaned_to_user_idx
    ON user_volumes (loaned_to_user_id)
    WHERE loaned_to_user_id IS NOT NULL;
