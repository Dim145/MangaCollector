const volumeQueries = require("../db/volumeQueries");

async function getAllVolumes(user_id, mal_id) {
  try {
    const response = await volumeQueries.getAllVolumes(user_id, mal_id);
    return response;
  } catch (error) {
    throw error;
  }
}

async function updateVolumeByID(id, owned, price, store) {
    try {
        await volumeQueries.updateVolumeByID(id, owned, price, store)
  } catch (error) {
    throw error;
  }
}

module.exports = { getAllVolumes, updateVolumeByID };
