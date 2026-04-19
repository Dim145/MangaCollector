import { useEffect, useLayoutEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import Header from "./components/Header";
import ProtectedRoute from "./components/ProtectedRoute";
import DefaultBackground from "@/components/DefaultBackground.jsx";

import About from "./components/About";
import Login from "./components/Login";
import Dashboard from "./components/Dashboard";
import MangaPage from "./components/MangaPage";
import AddPage from "@/components/AddPage.jsx";
import ProfilePage from "./components/ProfilePage";
import SettingsPage from "@/components/SettingsPage.jsx";
import Wishlist from "./components/Wishlist";

import SettingsContext from "@/SettingsContext.js";
import { getUserSettings } from "@/utils/user.js";
import { getAuthProvider } from "@/utils/auth.js";

export default function App() {
  const location = useLocation();
  const { manga, adult_content_level } = location.state || {};
  const [googleUser, setGoogleUser] = useState(null);
  const [settings, setSettings] = useState({});

  useEffect(() => {
    (async () => {
      // Always fetch public provider info — works even when logged out, so the
      // Login page knows what text/icon to render on the CTA button.
      const provider = await getAuthProvider();
      try {
        const s = await getUserSettings();
        setSettings({ ...provider, ...s });
      } catch {
        // Not authenticated — settings are private; fall back to provider info only.
        setSettings(provider);
      }
    })();
  }, []);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname]);

  return (
    <SettingsContext.Provider value={settings}>
      <Header />
      <main className="relative">
        <Routes>
          <Route path="/" element={<About />} />
          <Route path="/log-in" element={<Login />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute setGoogleUser={setGoogleUser}>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/wishlist"
            element={
              <ProtectedRoute setGoogleUser={setGoogleUser}>
                <Wishlist />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute setGoogleUser={setGoogleUser}>
                <ProfilePage googleUser={googleUser} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/mangapage"
            element={
              <ProtectedRoute setGoogleUser={setGoogleUser}>
                <MangaPage manga={manga} adult_content_level={adult_content_level} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute setGoogleUser={setGoogleUser}>
                <DefaultBackground>
                  <SettingsPage settingsUpdateCallback={(s) => setSettings(s)} />
                </DefaultBackground>
              </ProtectedRoute>
            }
          />
          <Route
            path="/addmanga"
            element={
              <ProtectedRoute setGoogleUser={setGoogleUser}>
                <DefaultBackground>
                  <AddPage />
                </DefaultBackground>
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
    </SettingsContext.Provider>
  );
}
