const userQueries = require("../db/userQueries");

async function getUserLibrary(user_id) {
  try {
    return await userQueries.getUserLibrary(user_id);
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

module.exports = {
  getUserLibrary,
  addToUserLibrary,
  deleteMangaFromUserLibraryByID,
};
