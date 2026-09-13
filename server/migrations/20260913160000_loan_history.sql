-- 預け · Loan history — the ledger the volume row cannot keep.
--
-- `user_volumes` only knows the current loan (borrower, start, due); the
-- moment a tome comes back, that it was ever out is forgotten. One row
-- here per loan, appended when a tome is lent, closed when it returns.
-- Names are snapshotted at lend time so renaming a series or a borrower
-- later does not rewrite the past; the volume link is kept while the row
-- exists and dropped (SET NULL) when the volume is deleted or rebuilt.
CREATE TABLE IF NOT EXISTS loan_history
(
    id               BIGSERIAL PRIMARY KEY,
    user_id          INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    volume_id        INTEGER     NULL REFERENCES user_volumes (id) ON DELETE SET NULL,
    mal_id           INTEGER     NOT NULL,
    vol_num          INTEGER     NOT NULL,
    series_name      TEXT        NOT NULL,
    borrower         TEXT        NOT NULL,
    borrower_user_id INTEGER     NULL REFERENCES users (id) ON DELETE SET NULL,
    borrower_slug    TEXT        NULL,
    loaned_at        TIMESTAMPTZ NOT NULL,
    due_at           TIMESTAMPTZ NULL,
    returned_at      TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS loan_history_user_loaned_idx ON loan_history (user_id, loaned_at DESC);
CREATE INDEX IF NOT EXISTS loan_history_open_idx ON loan_history (volume_id) WHERE returned_at IS NULL;
-- A tome cannot be lent twice at the same instant: this is what lets an
-- archive re-import upsert history rows instead of duplicating them.
CREATE UNIQUE INDEX IF NOT EXISTS loan_history_identity_idx ON loan_history (user_id, mal_id, vol_num, loaned_at);

-- Every loan open today gets its ledger row so the history starts honest.
INSERT INTO loan_history (user_id, volume_id, mal_id, vol_num, series_name, borrower, borrower_user_id, borrower_slug, loaned_at, due_at)
SELECT v.user_id, v.id, COALESCE(v.mal_id, 0), v.vol_num, COALESCE(l.name, ''), v.loaned_to, v.loaned_to_user_id, u.public_slug,
       COALESCE(v.loan_started_at, now()), v.loan_due_at
FROM user_volumes v
LEFT JOIN user_libraries l ON l.user_id = v.user_id AND l.mal_id = v.mal_id
LEFT JOIN users u ON u.id = v.loaned_to_user_id
WHERE v.loaned_to IS NOT NULL
ON CONFLICT (user_id, mal_id, vol_num, loaned_at) DO NOTHING;
