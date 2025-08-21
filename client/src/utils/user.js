import axios from "./axios";
import { checkAuthStatus } from "./auth";

async function addToUserLibrary(mangaData) {
  try {
    await axios.post(`/api/user/library`, mangaData);
  } catch (error) {
    console.error(error);
  }
}

export { addToUserLibrary };
