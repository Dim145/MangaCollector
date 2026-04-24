import axios from "./axios";

/*
 * Thin HTTP wrappers around the user-library API.
 *
 * Pruned down to the six endpoints the rest of the app actually uses
 * for *direct* server calls — everything else goes through a TanStack
 * Query hook (`useLibrary`, `useVolumes`, `useUpdateSettings`, etc.),
 * which handles caching, invalidation, and optimistic updates.
 *
 * Historically this file exported ~15 wrappers, most of which became
 * unused once the hooks layer landed. The dead ones were pruned
 * during the S4 cleanup sprint (see code-review doc) to keep the
 * utility surface small enough to reason about at a glance.
 */

async function addToUserLibrary(mangaData) {
  await axios.post(`/api/user/library`, mangaData);
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

async function addCustomEntryToUserLibrary(mangaData) {
  return (await axios.post(`/api/user/library/custom`, mangaData)).data;
}

async function addFromMangadexToUserLibrary(mangaData) {
  return (await axios.post(`/api/user/library/mangadex`, mangaData)).data;
}

async function refreshFromMangadex(mal_id) {
  return (
    await axios.get(`/api/user/library/${mal_id}/refresh-from-mangadex`)
  ).data;
}

export {
  addToUserLibrary,
  uploadPoster,
  removePoster,
  addCustomEntryToUserLibrary,
  addFromMangadexToUserLibrary,
  refreshFromMangadex,
};
