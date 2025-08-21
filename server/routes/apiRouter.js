const { Router } = require("express");
const apiRouter = new Router();
const userRouter = require("./userRouter");

apiRouter.use("/user", userRouter);

module.exports = apiRouter;
