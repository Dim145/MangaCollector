const { Router } = require("express");
const volumeRouter = new Router();
const volumeController = require("../controllers/volumeController");

volumeRouter.get("/", volumeController.getAllVolumes);
volumeRouter.get("/:mal_id", volumeController.getAllVolumesByID);
volumeRouter.patch("/", volumeController.updateVolumeByID);

module.exports = volumeRouter;
