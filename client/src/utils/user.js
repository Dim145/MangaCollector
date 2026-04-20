import axios from "./axios";

async function addToUserLibrary(mangaData) {
  await axios.post(`/api/user/library`, mangaData);
}

async function getUserLibrary() {
  const response = await axios.get(`/api/user/library`);
  return response.data;
}

async function getUserManga(mal_id) {
  const response = await axios.get(`/api/user/library/${mal_id}`);
  return response.data[0];
}

async function deleteMangaFromUserLibraryByID(mal_id) {
  await axios.delete(`/api/user/library/${mal_id}`);
}

async function updateMangaByID(mal_id, volumes) {
  await axios.patch(`/api/user/library/${mal_id}`, { volumes });
}

async function updateMangaOwned(mal_id, owned) {
  await axios.patch(`/api/user/library/${mal_id}/${owned}`);
}

async function getUserSettings() {
  return (await axios.get(`/api/user/settings`)).data;
}

async function updateSettings(settings) {
  return (
    await axios.post("/api/user/settings", {
      currency: settings.currency?.code,
      titleType: settings.titleType,
      adult_content_level: settings.adult_content_level,
      theme: settings.theme,
      language: settings.language,
    })
  ).data;
}

async function uploadPoster(mangaId, image) {
  const formData = new FormData();
  formData.append("poster", image);

  return await axios.post(`/api/user/storage/poster/${mangaId}`, formData);
}

async function removePoster(mangaId) {
  return (await axios.delete(`/api/user/storage/poster/${mangaId}`)).data
    ?.malPoster;
}

async function searchInLib(query) {
  return (await axios.get(`/api/user/library/search`, { params: { q: query } }))
    .data;
}

async function addCustomEntryToUserLibrary(mangaData) {
  return (await axios.post(`/api/user/library/custom`, mangaData)).data;
}

export {
  addToUserLibrary,
  getUserLibrary,
  getUserManga,
  deleteMangaFromUserLibraryByID,
  updateMangaByID,
  updateMangaOwned,
  updateSettings,
  getUserSettings,
  uploadPoster,
  removePoster,
  searchInLib,
  addCustomEntryToUserLibrary,
};
