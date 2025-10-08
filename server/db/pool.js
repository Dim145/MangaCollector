const { Pool } = require("pg");
require("dotenv").config();
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

pool.query(`
    CREATE TABLE IF NOT EXISTS users (
                           id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                           google_id VARCHAR(255) UNIQUE,
                           email VARCHAR(255) UNIQUE,
                           name VARCHAR(255),
                           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_libraries (
                                    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                                    user_id INT,
                                    mal_id INT,
                                    name TEXT,
                                    volumes INT,
                                    volumes_owned INT,
                                    image_url_jpg TEXT,
                                    FOREIGN KEY (user_id) REFERENCES users (id)
    );

    CREATE TABLE IF NOT EXISTS user_volumes (
                                  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                                  user_id INT,
                                  mal_id INT,
                                  vol_num INT,
                                  owned BOOLEAN,
                                  price NUMERIC(12, 2),
                                  store TEXT,
                                  FOREIGN KEY (user_id) REFERENCES users (id)
    );
`)

module.exports = pool;


