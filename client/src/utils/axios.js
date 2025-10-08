import axios from "axios";

const location = window?.location;

axios.defaults.baseURL = (location ? location.origin : undefined) || "http://localhost:5173";
axios.defaults.withCredentials = true;

export default axios;
