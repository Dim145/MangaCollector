CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    created_on  TIMESTAMP NOT NULL,
    modified_on TIMESTAMP NOT NULL,
    name        VARCHAR,
    email       VARCHAR UNIQUE,
    google_id   VARCHAR UNIQUE
);

CREATE TABLE IF NOT EXISTS user_libraries (
    id             SERIAL PRIMARY KEY,
    created_on     TIMESTAMP NOT NULL,
    modified_on    TIMESTAMP NOT NULL,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mal_id         INTEGER,
    name           VARCHAR NOT NULL,
    volumes        INTEGER NOT NULL DEFAULT 0,
    volumes_owned  INTEGER NOT NULL DEFAULT 0,
    image_url_jpg  VARCHAR
);

CREATE TABLE IF NOT EXISTS user_volumes (
    id          SERIAL PRIMARY KEY,
    created_on  TIMESTAMP NOT NULL,
    modified_on TIMESTAMP NOT NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mal_id      INTEGER,
    vol_num     INTEGER NOT NULL,
    owned       BOOLEAN NOT NULL DEFAULT false,
    price       DECIMAL(12, 2),
    store       VARCHAR
);
