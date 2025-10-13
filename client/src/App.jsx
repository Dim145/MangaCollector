// App.jsx
import { Routes, Route, useLocation } from "react-router-dom";
import Login from "./components/Login";
import Dashboard from "./components/Dashboard";
import ProtectedRoute from "./components/ProtectedRoute";
import Header from "./components/Header";
import About from "./components/About";
import ProfilePage from "./components/ProfilePage";
import MangaPage from "./components/MangaPage";
import Wishlist from "./components/Wishlist";
import {useEffect, useState} from "react";
import SettingsPage from "@/components/SettingsPage.jsx";
import DefaultBackground from "@/components/DefaultBackground.jsx";
import {getUserSettings} from "@/utils/user.js";
import SettingsContext from "@/SettingsContext.js";

export default function App() {
  const location = useLocation();
  const { manga, showAdultContent } = location.state || {};
  const [googleUser, setGoogleUser] = useState(null);
  const [settings, setSettings] = useState({});

  useEffect(() => {
    getUserSettings().then(s => setSettings(s));
  }, []);

  return (
    <>
      <Header />
      <SettingsContext.Provider value={settings}>
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
                <MangaPage manga={manga} showAdultContent={showAdultContent} />
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings"
            element={
              <ProtectedRoute setGoogleUser={setGoogleUser}>
                <DefaultBackground>
                  <SettingsPage settingsUpdateCallback={s => setSettings(s)} />
                </DefaultBackground>
              </ProtectedRoute>
            }
          />
        </Routes>
      </SettingsContext.Provider>
    </>
  );
}
