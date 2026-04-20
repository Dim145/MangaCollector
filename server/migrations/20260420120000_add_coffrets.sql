CREATE TABLE IF NOT EXISTS coffrets (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mal_id       INTEGER NOT NULL,
    name         TEXT NOT NULL,
    vol_start    INTEGER NOT NULL,
    vol_end      INTEGER NOT NULL,
    price        NUMERIC(10, 2),
    store        TEXT,
    created_on   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    modified_on  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT coffret_vol_range CHECK (vol_end >= vol_start)
);

CREATE INDEX IF NOT EXISTS coffrets_user_mal_idx ON coffrets(user_id, mal_id);

ALTER TABLE user_volumes
    ADD COLUMN IF NOT EXISTS coffret_id INTEGER
        REFERENCES coffrets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS user_volumes_coffret_idx ON user_volumes(coffret_id);
