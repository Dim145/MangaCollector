const volumeModel = require("../models/volumeModel");

async function getAllVolumes(req, res) {
  try {
    const user_id = req.user.id;
    const response = await volumeModel.getAllVolumes(user_id);
    res.json(response);
  } catch (error) {
    res.json({
      success: false,
      error: error.message || "Error getting manga volumes",
    });
  }
}

async function getAllVolumesByID(req, res) {
  try {
    const user_id = req.user.id;
    const mal_id = req.params.mal_id;
    const response = await volumeModel.getAllVolumesByID(user_id, mal_id);
    res.json(response);
  } catch (error) {
    res.json({
      success: false,
      error: error.message || "Error getting manga volumes",
    });
  }
}

async function updateVolumeByID(req, res) {
  try {
    const id = req.body.id;
    const owned = req.body.owned;
    const price = req.body.price;
    const store = req.body.store;
    await volumeModel.updateVolumeByID(id, owned, price, store);
    res.json({
      success: true,
      message: "Volume updated successfully",
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message || "Error updating manga volume",
    });
  }
}

module.exports = { getAllVolumes, getAllVolumesByID, updateVolumeByID };
