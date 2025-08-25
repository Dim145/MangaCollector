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
  for (let i = 1; i <= volumes; i++) {
    await db.query(
      `INSERT INTO user_volumes (user_id, mal_id, vol_num, owned, price, store) 
          VALUES ($1, $2, $3, $4, $5, $6)`,
      [user_id, mal_id, i, false, 0, ""],
    );
  }
}

async function deleteMangaFromUserLibraryByID(mal_id, user_id) {
  await db.query(
    `DELETE FROM user_libraries WHERE user_id = $1 AND mal_id = $2;`,
    [user_id, mal_id],
  );

  await db.query(
    `DELETE FROM user_volumes WHERE user_id = $1 AND mal_id = $2`,
    [user_id, mal_id],
  );
}

async function getTotalVolumesByID(mal_id, user_id) {
  const result = await db.query(
    `SELECT volumes 
     FROM user_libraries 
     WHERE user_id = $1 AND mal_id = $2;`,
    [user_id, mal_id],
  );

  if (result.rows.length === 0) {
    return null; // no record
  }

  return result.rows[0].volumes; // just the number
}

async function removeVolumeByID(mal_id, user_id, vol_num) {
  await db.query(
    "DELETE FROM user_volumes WHERE user_id = $1 AND mal_id = $2 AND vol_num = $3",
    [user_id, mal_id, vol_num],
  );
}

async function addVolumeByID(mal_id, user_id, vol_num) {
  await db.query(
    `INSERT INTO user_volumes (user_id, mal_id, vol_num, owned, price, store) 
          VALUES ($1, $2, $3, $4, $5, $6)`,
    [user_id, mal_id, vol_num, false, 0, ""],
  );
}

async function updateMangaByID(mal_id, user_id, volumes) {
  const oldTotal = await getTotalVolumesByID(mal_id, user_id);

  if (oldTotal == volumes) {
    return;
  } else if (oldTotal > volumes) {
    for (let i = oldTotal; i > volumes; i--) {
      await removeVolumeByID(mal_id, user_id, i);
    }
  } else if (oldTotal < volumes) {
    for (let i = oldTotal + 1; i <= volumes; i++) {
      await addVolumeByID(mal_id, user_id, i);
    }
  }

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
  getTotalVolumesByID,
};
