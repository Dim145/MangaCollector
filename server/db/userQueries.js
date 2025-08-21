const db = require("./pool");

async function getUserLibrary(user_id) {
  const result = await db.query(
    "SELECT * FROM user_libraries WHERE user_id = $1",
    [user_id],
  );
  return result.rows;
}

async function addToUserLibrary(user_id, mangaData) {
  const { name, mal_id, volumes, volumes_owned, image_url_jpg } = mangaData;
  await db.query(
    `INSERT INTO user_libraries (user_id, mal_id, name, volumes, volumes_owned, image_url_jpg) 
        VALUES ($1, $2, $3, $4, $5, $6)`,
    [user_id, mal_id, name, volumes, volumes_owned, image_url_jpg],
  );
}

module.exports = { getUserLibrary, addToUserLibrary };
