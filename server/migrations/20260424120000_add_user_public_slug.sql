-- Public profile slug — optional human-readable URL handle for the
-- `/u/{slug}` read-only gallery. NULL = profile is private (default).
-- Uniqueness is enforced at the column level so two users can't reserve
-- the same handle. Stored lower-case; validation + normalisation happen
-- in the Rust service before insert (3..32 chars, [a-z0-9-], cannot
-- start or end with `-`).
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS public_slug VARCHAR(32) UNIQUE NULL;

-- Lookup index — restricted to non-null rows to keep it small. The
-- public GET endpoint hits this on every anonymous visit so it has to
-- be sub-millisecond even at scale.
CREATE INDEX IF NOT EXISTS users_public_slug_idx
    ON users(public_slug)
    WHERE public_slug IS NOT NULL;
