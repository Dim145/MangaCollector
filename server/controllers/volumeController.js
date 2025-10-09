const volumes = require("../services/volumes");

async function getAllVolumes(req, res) {
  try {
    const user_id = req.user.id;
    const response = await volumes.getAllVolumesForUser(user_id);
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
    const response = await volumes.getAllVolumesForUserById(user_id, mal_id);
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
    await volumes.updateVolumeById(id, owned, price, store);
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
