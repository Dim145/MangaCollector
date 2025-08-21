const { Router } = require("express");
const userRouter = new Router();
const userController = require("../controllers/userController");

userRouter.get("/library", userController.getUserLibrary);
userRouter.post("/library", userController.addToUserLibrary);

module.exports = userRouter;
