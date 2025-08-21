const { Router } = require("express");
const userRouter = new Router();
const userController = require("../controllers/userController");

userRouter.get("/library/:user_id", userController.getUserLibrary);

module.exports = userRouter;
