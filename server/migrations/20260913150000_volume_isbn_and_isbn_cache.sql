-- 番 · The ISBN of the copy on the shelf, and a shared resolver cache.
--
-- Until now the only ISBN a volume row carried was `release_isbn`, the
-- number of an *announced* tome. The copy the collector actually scanned
-- never kept its own, which ruled out "scan a spine → open the tome",
-- duplicate detection at scan time and printable labels. Stored in the
-- 13-digit form (ISBN-10 is converted on the way in).
ALTER TABLE user_volumes
    ADD COLUMN IF NOT EXISTS isbn VARCHAR(13) NULL;
CREATE INDEX IF NOT EXISTS user_volumes_user_isbn_idx
    ON user_volumes (user_id, isbn)
    WHERE isbn IS NOT NULL;

-- One row per ISBN ever resolved by the server, whatever the user: the
-- external catalogues (Google Books, Open Library, BnF, openBD) answer
-- the same for everyone, so the whole instance shares one cache. Misses
-- are cached too (shorter TTL) so a barcode nobody knows is not retried
-- against four services on every scan.
CREATE TABLE IF NOT EXISTS isbn_cache
(
    isbn       VARCHAR(13) PRIMARY KEY,
    found      BOOLEAN     NOT NULL,
    source     TEXT,
    payload    TEXT,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
