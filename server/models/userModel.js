const userQueries = require("../db/userQueries");

async function getUserLibrary(user_id) {
  try {
    return await userQueries.getUserLibrary(user_id);
  } catch (err) {
    throw err;
  }
}

module.exports = { getUserLibrary };
