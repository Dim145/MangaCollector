const userModel = require("../models/userModel");

async function getUserLibrary(req, res) {
  try {
    const user_id = req.params.user_id
    const response = await userModel.getUserLibrary(user_id);
    return res.json(response)
  } catch (err) {
    return res.json({
      success: false,
      error: err.message || "Error fetching user's library",
    });
  }
}

module.exports = { getUserLibrary };
