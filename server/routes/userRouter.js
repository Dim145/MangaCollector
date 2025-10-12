const { Router } = require("express");
const userRouter = new Router();

const libraryRouter = require("./libraryRouter");
const volumeRouter = require("./volumeRouter");
const settingRouter = require("./settingRouter");

userRouter.use("/library", libraryRouter);
userRouter.use("/volume", volumeRouter);
userRouter.use("/settings", settingRouter);

module.exports = userRouter;
