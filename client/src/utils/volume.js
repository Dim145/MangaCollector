import axios from "./axios";

async function getAllVolumes(mal_id) {
  try {
    const response = await axios.get(`/api/user/volume/${mal_id}`);
    return response.data;
  } catch (error) {
    throw error;
  }
}

async function updateVolumeByID(id, owned, price, store) {
  try {
    await axios.patch(`/api/user/volume`, { id, owned, price, store });
  } catch (error) {
    throw error;
  }
}

export { getAllVolumes, updateVolumeByID };
