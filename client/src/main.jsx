import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/index.css";
import App from "./App.jsx";
import { bootstrapThemeFromStorage } from "./lib/theme.js";

// Apply the user's last-known theme before React mounts so the first paint
// never flashes the wrong palette. The authoritative value arrives a bit
// later from the server-side settings.
bootstrapThemeFromStorage();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
