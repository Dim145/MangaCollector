const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.SUPABASE_URL,
  ssl: { rejectUnauthorized: false }, // required for Supabase
});

module.exports = pool;

/*

CREATE TABLE users (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    google_id VARCHAR(255) UNIQUE,
    email VARCHAR(255) UNIQUE,
    name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_libraries (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT,
  mal_id INT,
  name TEXT,
  volumes INT,
  volumes_owned INT,
  image_url_jpg TEXT,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE user_volumes (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT,
  mal_id INT,
  vol_num INT,
  owned BOOLEAN,
  price NUMERIC(12, 2),
  store TEXT,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE "session" (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

*/
