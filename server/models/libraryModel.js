const libraryQueries = require("../db/libraryQueries");

async function getUserLibrary(user_id) {
  try {
    return await libraryQueries.getUserLibrary(user_id);
  } catch (err) {
    throw err;
  }
}

async function getUserManga(mal_id, user_id) {
  try {
    return await libraryQueries.getUserManga(mal_id, user_id);
  } catch (err) {
    throw err;
  }
}

async function addToUserLibrary(user_id, mangaData) {
  try {
    await libraryQueries.addToUserLibrary(user_id, mangaData);
  } catch (err) {
    throw err;
  }
}

async function deleteMangaFromUserLibraryByID(mal_id, user_id) {
  try {
    await libraryQueries.deleteMangaFromUserLibraryByID(mal_id, user_id);
  } catch (error) {
    throw err;
  }
}

async function updateMangaByID(mal_id, user_id, volumes) {
  try {
    await libraryQueries.updateMangaByID(mal_id, user_id, volumes);
  } catch (error) {
    throw err;
  }
}

async function updateMangaOwned(user_id, mal_id, owned) {
  try {
    await libraryQueries.updateMangaOwned(user_id, mal_id, owned);
  } catch (error) {
    throw error;
  }
}

module.exports = {
  getUserLibrary,
  getUserManga,
  addToUserLibrary,
  deleteMangaFromUserLibraryByID,
  updateMangaByID,
  updateMangaOwned,
};
