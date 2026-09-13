-- 棚 · Places as a registry. A tome keeps pointing at its place by name
-- (`user_volumes.location`) — that is what the offline cache and the
-- archive already carry — and this table gives each name what a bare
-- string cannot: a note, an order, and an identity to rename or empty
-- a whole shelf in one move.
CREATE TABLE IF NOT EXISTS locations (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(80) NOT NULL,
    note        TEXT,
    position    INTEGER NOT NULL DEFAULT 0,
    created_on  TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_on TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_locations_user_position
    ON locations (user_id, position, name);

-- Counting what sits on a shelf is a grouped scan of the user's tomes.
CREATE INDEX IF NOT EXISTS idx_user_volumes_user_location
    ON user_volumes (user_id, location)
    WHERE location IS NOT NULL;

-- Every place already typed on a tome becomes a row, in the order it
-- first appeared on the shelf.
INSERT INTO locations (user_id, name, position)
SELECT user_id,
       location,
       ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY MIN(created_on), location) - 1
FROM user_volumes
WHERE location IS NOT NULL AND btrim(location) <> ''
GROUP BY user_id, location
ON CONFLICT (user_id, name) DO NOTHING;
