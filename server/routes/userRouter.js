const { Router } = require("express");
const userRouter = new Router();

const libraryRouter = require("./libraryRouter");
const volumeRouter = require("./volumeRouter");

userRouter.use("/library", libraryRouter)
userRouter.use("/volume", volumeRouter)

module.exports = userRouter;
