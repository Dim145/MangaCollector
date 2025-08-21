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

module.exports = { getUserLibrary, addToUserLibrary };
