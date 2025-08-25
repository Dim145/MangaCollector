const libraryModel = require("../models/libraryModel");

async function getUserLibrary(req, res) {
  try {
    const user_id = req.user.id;
    const response = await libraryModel.getUserLibrary(user_id);
    return res.json(response);
  } catch (err) {
    return res.json({
      success: false,
      error: err.message || "Error fetching user's library",
    });
  }
}

async function getUserManga(req, res) {
  try {
    const user_id = req.user.id;
    const mal_id = req.params.mal_id;
    const response = await libraryModel.getUserManga(mal_id, user_id);
    return res.json(response);
  } catch (err) {
    return res.json({
      success: false,
      error: err.message || "Error fetching user's library",
    });
  }
}

async function addToUserLibrary(req, res) {
  try {
    const user_id = req.user.id;
    const mangaData = req.body;
    console.log(mangaData);
    await libraryModel.addToUserLibrary(user_id, mangaData);
    res.json({ success: true, message: "Added manga to library successfully" });
  } catch (error) {
    res.json({
      success: false,
      error: error.message || "Error inserting to library",
    });
  }
}

async function deleteMangaFromUserLibraryByID(req, res) {
  try {
    const mal_id = req.params.mal_id;
    const user_id = req.user.id;
    await libraryModel.deleteMangaFromUserLibraryByID(mal_id, user_id);
    res.json({
      success: true,
      message: "Removed manga from library successfully",
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message || "Error removing manga from library",
    });
  }
}

async function updateMangaByID(req, res) {
  try {
    const mal_id = req.params.mal_id;
    const user_id = req.user.id;
    const volumes = req.body.volumes;
    await libraryModel.updateMangaByID(mal_id, user_id, volumes);
    res.json({
      success: true,
      message: "Updated manga in library successfully",
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message || "Error updating manga in library",
    });
  }
}

module.exports = {
  getUserLibrary,
  getUserManga,
  addToUserLibrary,
  deleteMangaFromUserLibraryByID,
  updateMangaByID,
};
