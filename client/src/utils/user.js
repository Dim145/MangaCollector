import axios from "./axios";
import { checkAuthStatus } from "./auth";

async function addToUserLibrary(mangaData) {
  try {
    await axios.post(`/api/user/library`, mangaData);
  } catch (error) {
    throw error;
  }
}

async function getUserLibrary() {
  try {
    const response = await axios.get(`/api/user/library`);
    return response.data;
  } catch (error) {
    throw error;
  }
}

async function getUserManga(mal_id) {
  try {
    const response = await axios.get(`/api/user/library/${mal_id}`);
    return response.data[0];
  } catch (error) {
    throw error;
  }
}

async function deleteMangaFromUserLibraryByID(mal_id) {
  try {
    await axios.delete(`/api/user/library/${mal_id}`);
  } catch (error) {
    throw error;
  }
}

async function updateMangaByID(mal_id, volumes) {
  try {
    await axios.patch(`/api/user/library/${mal_id}`, { volumes });
  } catch (error) {
    throw error;
  }
}

async function updateMangaOwned(mal_id, owned) {
  try {
    await axios.patch(`/api/user/library/${mal_id}/${owned}`);
  } catch (error) {
    throw error;
  }
}

async function getShowAdultContent() {
  return (await getUserSettings())["show-adult-content"];
}

async function getUserSettings() {
  return (await axios.get(`/api/user/settings`)).data;
}

async function updateSettings(settings) {
  return (
    await axios.post("/api/user/settings", {
      "show-adult-content": settings.showAdultContent,
      currency: settings.currency?.code,
    })
  ).data;
}

export {
  addToUserLibrary,
  getUserLibrary,
  getUserManga,
  deleteMangaFromUserLibraryByID,
  updateMangaByID,
  updateMangaOwned,
  getShowAdultContent,
  updateSettings,
  getUserSettings
};
