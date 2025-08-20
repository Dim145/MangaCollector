import axios from "./axios";
import { useNavigate } from "react-router-dom";

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

// Logout user
export const logout = async () => {
  try {
    const navigate = useNavigate();
    const response = await axios.post("/auth/logout");

    if (response.status == 200) {
      navigate("/log-in");
      return true;
    }
    return false;
  } catch (error) {
    console.error("Logout failed:", error);
    return false;
  }
};

// Start OAuth2 flow
export const initiateOAuth = () => {
  window.location.href = `${axios.defaults.baseURL}/auth/oauth2`;
};
