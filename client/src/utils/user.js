import axios from "./axios";
import { checkAuthStatus } from "./auth";

async function addToUserLibrary(mangaData) {
  try {
    await axios.post(`/api/user/library`, mangaData);
  } catch (error) {
    throw error
  }
}

async function getUserLibrary() {
    try {
        const response = await axios.get(`/api/user/library`)
        return response.data
    } catch (error) {
        throw error
    }
}
export { addToUserLibrary, getUserLibrary };
