const { Router } = require("express");
const userRouter = new Router();
const userController = require("../controllers/userController");

userRouter.get("/library", userController.getUserLibrary);
userRouter.post("/library", userController.addToUserLibrary);
userRouter.delete(
  "/library/:mal_id",
  userController.deleteMangaFromUserLibraryByID,
);

module.exports = userRouter;
