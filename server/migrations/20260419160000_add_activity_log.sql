CREATE TABLE IF NOT EXISTS activity_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    mal_id INTEGER,
    vol_num INTEGER,
    name TEXT,
    count_value INTEGER,
    created_on TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_user_created
    ON activity_log(user_id, created_on DESC);
