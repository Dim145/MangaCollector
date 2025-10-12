const { Router } = require("express");
const libraryRouter = new Router();
const libraryController = require("../controllers/libraryController");

libraryRouter.get("/", libraryController.getUserLibrary);
libraryRouter.get("/:mal_id", libraryController.getUserManga);
libraryRouter.get("/:mal_id/update-from-mal", libraryController.updateInfosFromMal);

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
libraryRouter.patch("/:mal_id/:owned", libraryController.updateMangaOwned);

module.exports = libraryRouter;
