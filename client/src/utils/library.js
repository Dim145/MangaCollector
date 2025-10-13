import axios from "@/utils/axios.js";

const hasToBlurImage = ({ genres }, showAdultContent = false) =>
  !showAdultContent &&
  (genres || []).some((g) =>
    ["hentai", "erotica", "adult"].includes(g.toLowerCase()),
  );

const updateLibFromMal = async (malId) =>
  (await axios.get(`/api/user/library/${malId}/update-from-mal`)).data;

const updateVolumeOwned = async (malId, nbOwned) => {
  await axios.patch(`/api/user/library/${malId}/${nbOwned}`);
};

export { hasToBlurImage, updateLibFromMal, updateVolumeOwned };
