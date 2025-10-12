const {Router} = require("express");

const settingRouter = new Router();

const settingController = require("../controllers/settingController");

settingRouter.get("/", settingController.getUserSettings);

module.exports = settingRouter;
