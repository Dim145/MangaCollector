const { Router } = require("express");
const volumeRouter = new Router();
const volumeController = require("../controllers/volumeController");

volumeRouter.get("/:mal_id", volumeController.getAllVolumes);
volumeRouter.patch("/", volumeController.updateVolumeByID)

module.exports = volumeRouter;
