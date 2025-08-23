const userQueries = require("../db/userQueries");

async function getUserLibrary(user_id) {
  try {
    return await userQueries.getUserLibrary(user_id);
  } catch (err) {
    throw err;
  }
}

async function getUserManga(mal_id, user_id) {
  try {
    return await userQueries.getUserManga(mal_id, user_id);
  } catch (err) {
    throw err;
  }
}

async function addToUserLibrary(user_id, mangaData) {
  try {
    await userQueries.addToUserLibrary(user_id, mangaData);
  } catch (err) {
    throw err;
  }
}

async function deleteMangaFromUserLibraryByID(mal_id, user_id) {
  try {
    await userQueries.deleteMangaFromUserLibraryByID(mal_id, user_id);
  } catch (error) {
    throw err;
  }
}

async function updateMangaByID(mal_id, user_id, volumes) {
  try {
    await userQueries.updateMangaByID(mal_id, user_id, volumes);
  } catch (error) {
    throw err;
  }
}

module.exports = {
  getUserLibrary,
  getUserManga,
  addToUserLibrary,
  deleteMangaFromUserLibraryByID,
  updateMangaByID,
};
