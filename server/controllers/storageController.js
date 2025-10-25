const storage = require("../services/storage");
const library = require("../services/library");

async function uploadPoster(req, res) {
  try {
    const files = req.files;

    if (!files || Object.keys(files).length === 0) {
      return res.status(400).json({
        success: false,
        error: "No files uploaded",
      });
    }

    const malId = req.params.mal_id;
    const userId = req.user.id;

    if (!malId) {
      return res.status(400).json({
        success: false,
        error: "Missing mal_id parameter",
      });
    }

    const libraryEntry = await library.getUserManga(malId, userId);

    if (!libraryEntry) {
      return res.status(404).json({
        success: false,
        error: "Manga not found in user's library",
      });
    }

    if(libraryEntry.image_url_jpg && !`${libraryEntry.image_url_jpg}`.startsWith("http"))
    {
      // an existing custom poster is present, remove it
      await storage.removeFile(libraryEntry.image_url_jpg);
    }

    const file = files.poster;
    const filePath = `uploads/images/${userId}/${malId}.jpg`;

    await storage.putFile(filePath, file.data);

    await library.changePoster(userId, malId, `/api/user/storage/poster/${malId}`);

    res.json({
      success: true,
      message: "File uploaded successfully",
      filePath: filePath,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || "Error uploading files",
    });
  }
}

async function getPoster(req, res) {
  try {
    const userId = req.user.id;
    const malId = req.params.mal_id;

    if (!malId) {
      return res.status(400).json({
        success: false,
        error: "Missing mal_id parameter",
      });
    }

    const libraryEntry = (await library.getUserManga(malId, userId))?.pop();

    if (!libraryEntry) {
      return res.status(404).json({
        success: false,
        error: "Manga not found in user's library",
      });
    }

    if(!libraryEntry.image_url_jpg || `${libraryEntry.image_url_jpg}`.startsWith("http"))
    {
      return res.status(404).json({
        success: false,
        error: "No custom poster found for this manga",
      });
    }

    const fileStream = await storage.getFile(`uploads/images/${userId}/${malId}.jpg`);

    res.setHeader('Content-Disposition', `inline; filename="${malId}_poster"`);
    res.setHeader('Content-Type', 'image/jpeg');
    fileStream.pipe(res);
  }
  catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || "Error retrieving file",
    });
  }
}

module.exports = {
  uploadPoster,
  getPoster
}
