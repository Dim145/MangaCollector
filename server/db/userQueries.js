const db = require("./pool");

async function getUserLibrary(user_id) {
  const result = await db.query(
    "SELECT * FROM user_libraries WHERE user_id = $1",
    [user_id],
  );
  return result.rows;
}

async function getUserManga(mal_id, user_id) {
  const result = await db.query(
    "SELECT * FROM user_libraries WHERE user_id = $1 AND mal_id = $2",
    [user_id, mal_id],
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

async function deleteMangaFromUserLibraryByID(mal_id, user_id) {
  await db.query(
    `DELETE FROM user_libraries WHERE user_id = $1 AND mal_id = $2;`,
    [user_id, mal_id],
  );
}

async function updateMangaByID(mal_id, user_id, volumes) {
  await db.query(
    `UPDATE user_libraries SET volumes = $1 WHERE user_id = $2 AND mal_id = $3;`,
    [volumes, user_id, mal_id],
  );
}

module.exports = {
  getUserLibrary,
  addToUserLibrary,
  deleteMangaFromUserLibraryByID,
  updateMangaByID,
  getUserManga,
};
