import axios from "@/utils/axios.js";

const isAdultGenre = g => ["hentai", "erotica", "adult"].includes(g.toLowerCase());

const hasToBlurImage = ({ genres }, adult_content_level = 0) =>
  adult_content_level !== 2 &&
  (genres || []).some(isAdultGenre);

const filterAdultGenreIfNeeded = (adult_content_level = 0, mangas) => {
  if (adult_content_level !== 1)
    return mangas;

  return mangas.filter(manga => (manga.genres || []).every(g => !isAdultGenre(g)));
}

const updateLibFromMal = async (malId) =>
  (await axios.get(`/api/user/library/${malId}/update-from-mal`)).data;

const updateVolumeOwned = async (malId, nbOwned) => {
  await axios.patch(`/api/user/library/${malId}/${nbOwned}`);
};

export { hasToBlurImage, updateLibFromMal, updateVolumeOwned, filterAdultGenreIfNeeded };
