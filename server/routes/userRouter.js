const { Router } = require("express");
const userRouter = new Router();
const userController = require("../controllers/userController");

userRouter.get("/library", userController.getUserLibrary);
userRouter.get("/library/:mal_id", userController.getUserManga);
userRouter.post("/library", userController.addToUserLibrary);
userRouter.delete(
  "/library/:mal_id",
  userController.deleteMangaFromUserLibraryByID,
);
userRouter.delete(
  "/library/:mal_id",
  userController.deleteMangaFromUserLibraryByID,
);
userRouter.patch("/library/:mal_id", userController.updateMangaByID);

module.exports = userRouter;
