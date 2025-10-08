import axios from "axios";

axios.defaults.baseURL = process.env.FRONTEND_URL || document?.URL || "http://localhost:5173";
axios.defaults.withCredentials = true;

export default axios;
