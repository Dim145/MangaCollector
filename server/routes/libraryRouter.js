const { Router } = require("express");
const libraryRouter = new Router();
const libraryController = require("../controllers/libraryController");

libraryRouter.get("/", libraryController.getUserLibrary);
libraryRouter.get("/:mal_id", libraryController.getUserManga);
libraryRouter.post("/", libraryController.addToUserLibrary);
libraryRouter.delete(
  "/:mal_id",
  libraryController.deleteMangaFromUserLibraryByID,
);
libraryRouter.delete(
  "/:mal_id",
  libraryController.deleteMangaFromUserLibraryByID,
);
libraryRouter.patch("/:mal_id", libraryController.updateMangaByID);

module.exports = libraryRouter;
