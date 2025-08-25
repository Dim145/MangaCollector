const { Router } = require("express");
const volumeRouter = new Router();
const volumeController = require("../controllers/volumeController");

volumeRouter.get("/:mal_id", volumeController.getAllVolumes);

module.exports = volumeRouter;
