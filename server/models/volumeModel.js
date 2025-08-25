const volumeQueries = require("../db/volumeQueries");

async function getAllVolumes(user_id, mal_id) {
  try {
    const response = await volumeQueries.getAllVolumes(user_id, mal_id);
    return response;
  } catch (error) {
    throw error;
  }
}

module.exports = { getAllVolumes };
