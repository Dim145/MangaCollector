CREATE TABLE IF NOT EXISTS tower_sessions (
    id          TEXT PRIMARY KEY,
    data        BYTEA NOT NULL,
    expiry_date TIMESTAMPTZ NOT NULL
);
