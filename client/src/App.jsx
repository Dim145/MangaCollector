import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";

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
import OfflineBanner from "@/components/OfflineBanner.jsx";
import SyncToaster from "@/components/SyncToaster.jsx";

import SettingsContext from "@/SettingsContext.js";
import { queryClient } from "@/lib/queryClient.js";
import { installConnectivityWatcher } from "@/lib/connectivity.js";
import { installSyncRunner } from "@/lib/sync.js";
import { useAuthProvider } from "@/hooks/useAuthProvider.js";
import { useUserSettings } from "@/hooks/useSettings.js";

function SettingsProvider({ children }) {
  const provider = useAuthProvider();
  const { data: settings } = useUserSettings();
  const merged = useMemo(
    () => ({ ...(provider ?? {}), ...(settings ?? {}) }),
    [provider, settings]
  );
  return (
    <SettingsContext.Provider value={merged}>
      {children}
    </SettingsContext.Provider>
  );
}

function AppShell() {
  const location = useLocation();
  const { manga, adult_content_level } = location.state || {};
  const [googleUser, setGoogleUser] = useState(null);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname]);

  return (
    <>
      <Header />
      <OfflineBanner />
      <SyncToaster />
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
                  <SettingsPage />
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
    </>
  );
}

export default function App() {
  useEffect(() => {
    // Order matters: the connectivity watcher installs the axios interceptor
    // that feeds the sync runner's "is-server-reachable" signal.
    installConnectivityWatcher();
    installSyncRunner();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <AppShell />
      </SettingsProvider>
    </QueryClientProvider>
  );
}
