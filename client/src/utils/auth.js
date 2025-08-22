import axios from "./axios";

// Check if user is authenticated
export const checkAuthStatus = async () => {
  try {
    const response = await axios.get("/auth/user");
    return response.status == 200 ? response.data : null;
  } catch (error) {
    console.error("Auth check failed:", error);
    return null;
  }
};

export const logout = async () => {
  try {
    const response = await axios.post("/auth/oauth2/logout");
  } catch (error) {
    throw error;
  }
};

// Start OAuth2 flow
export const initiateOAuth = () => {
  window.location.href = `${axios.defaults.baseURL}/auth/oauth2`;
};
