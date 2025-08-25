const volumeModel = require("../models/volumeModel")

async function getAllVolumes(req, res) {
    try {
        const user_id = req.user.id
        const mal_id = req.params.mal_id
        const response = await volumeModel.getAllVolumes(user_id, mal_id)
        res.json(response)
    } catch (error) {
        res.json({
            success: false,
            error: error.message || "Error getting manga volumes",
            });
    }
}

module.exports = { getAllVolumes }