import axios from "./axios";

async function getAllVolumes(mal_id) {
  try {
    const response = await axios.get(`/api/user/volume/${mal_id}`);
    return response.data;
  } catch (error) {
    throw error;
  }
}

export { getAllVolumes };
