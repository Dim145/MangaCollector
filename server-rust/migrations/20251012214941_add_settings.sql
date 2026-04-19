CREATE TABLE IF NOT EXISTS settings (
    id           SERIAL PRIMARY KEY,
    created_on   TIMESTAMP NOT NULL,
    modified_on  TIMESTAMP NOT NULL,
    user_id      INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    "show-adult-content" BOOLEAN DEFAULT false,
    currency     VARCHAR NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'EUR'))
);

ALTER TABLE users DROP COLUMN IF EXISTS "show-adult-content";
