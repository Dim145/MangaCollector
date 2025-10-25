const {Router} = require("express");
const storageController = require("../controllers/storageController");

const storageRouter = new Router();

storageRouter.get("/poster/:mal_id", storageController.getPoster);
storageRouter.post("/poster/:mal_id", storageController.uploadPoster);
storageRouter.delete("/poster/:mal_id", storageController.deletePoster);

module.exports = storageRouter;
