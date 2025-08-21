const db = require("./pool");

async function getUserLibrary(user_id) {
  const result = await db.query(
    "SELECT * FROM user_libraries WHERE user_id = $1",
    [user_id],
  );
  return result.rows;
}

module.exports = { getUserLibrary };
