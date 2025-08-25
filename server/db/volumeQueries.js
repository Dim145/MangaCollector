const db = require("./pool");

async function getAllVolumes(user_id, mal_id) {
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

module.exports = { getAllVolumes };
