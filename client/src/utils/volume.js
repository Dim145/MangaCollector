import axios from "./axios";

async function getAllVolumes() {
  const response = await axios.get("/api/user/volume");
  return response.data;
}

async function getAllVolumesByID(mal_id) {
  const response = await axios.get(`/api/user/volume/${mal_id}`);
  return response.data;
}

async function updateVolumeByID(id, owned, price, store) {
  await axios.patch(`/api/user/volume`, { id, owned, price, store });
}

export { getAllVolumes, getAllVolumesByID, updateVolumeByID };
