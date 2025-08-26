const db = require("./pool");

async function getAllVolumes(user_id) {
  try {
    const response = await db.query(
      `SELECT * FROM user_volumes WHERE user_id = $1`,
      [user_id],
    );
    return response.rows;
  } catch (error) {
    throw error;
  }
}
async function getAllVolumesByID(user_id, mal_id) {
  try {
    const response = await db.query(
      `SELECT * FROM user_volumes WHERE user_id = $1 AND mal_id = $2`,
      [user_id, mal_id],
    );
    return response.rows;
  } catch (error) {
    throw error;
  }
}

async function updateVolumeByID(id, owned, price, store) {
  try {
    await db.query(
      `UPDATE user_volumes
       SET owned = $1, price = $2, store = $3
       WHERE id = $4`,
      [owned, price, store, id],
    );
  } catch (error) {
    throw error;
  }
}

module.exports = { getAllVolumes, getAllVolumesByID, updateVolumeByID };
