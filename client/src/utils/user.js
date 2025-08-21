import axios from "./axios";
import { checkAuthStatus } from "./auth";

async function addToUserLibrary(mangaData) {
  try {
    const response = await checkAuthStatus();
    const user_id = response.id;
    console.log(mangaData)
    await axios.post(`/api/user/library/${user_id}`, mangaData);
  } catch (error) {
    console.error(error);
  }
}

export { addToUserLibrary };
