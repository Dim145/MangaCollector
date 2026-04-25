import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  bootstrapLanguage,
  I18nProvider,
  rememberLanguage,
} from "@/i18n/index.jsx";

// Eager — always on screen, no point code-splitting these
import Header from "./components/Header";
import ProtectedRoute from "./components/ProtectedRoute";
import DefaultBackground from "@/components/DefaultBackground.jsx";
import OfflineBanner from "@/components/OfflineBanner.jsx";
import SyncToaster from "@/components/SyncToaster.jsx";
import PageLoader from "@/components/PageLoader.jsx";

// Lazy routes — each lands in its own JS chunk so first paint ships less.
// Recharts rides with ProfilePage, @zxing rides with AddPage via its own
// dynamic import inside barcode.js.
const About = lazy(() => import("./components/About"));
const Login = lazy(() => import("./components/Login"));
const Dashboard = lazy(() => import("./components/Dashboard"));
const MangaPage = lazy(() => import("./components/MangaPage"));
const AddPage = lazy(() => import("@/components/AddPage.jsx"));
const ProfilePage = lazy(() => import("./components/ProfilePage"));
const SettingsPage = lazy(() => import("@/components/SettingsPage.jsx"));
const SealsPage = lazy(() => import("./components/SealsPage"));
const PublicProfile = lazy(() => import("./components/PublicProfile"));
const ImportExternalPage = lazy(() =>
  import("./components/ImportExternalPage"),
);
const ComparePage = lazy(() => import("./components/ComparePage"));

import SettingsContext from "@/SettingsContext.js";
import { queryClient } from "@/lib/queryClient.js";
import { installConnectivityWatcher } from "@/lib/connectivity.js";
import { installSyncRunner } from "@/lib/sync.js";
import { applyThemePreference, rememberThemePreference } from "@/lib/theme.js";
import { useAuthProvider } from "@/hooks/useAuthProvider.js";
import { useUserSettings } from "@/hooks/useSettings.js";
import { useRealtimeSync } from "@/hooks/useRealtimeSync.js";
import axios from "@/utils/axios.js";
import {
  cacheAllVolumes,
  cacheLibrary,
  cacheSettings,
  db,
  SETTINGS_KEY,
} from "@/lib/db.js";

/**
 * Warm the Dexie cache for core user data during idle time after mount,
 * so internal navigation (Dashboard/Profile/Settings) paints from cache
 * without waiting for an HTTP round-trip.
 *
 * Gated on a positive "was-authenticated" signal (any existing Dexie row)
 * so first-time visitors on the About page don't fire 401s.
 */
async function prefetchCoreUserData() {
  try {
    const hasPrior = await db.settings.get(SETTINGS_KEY);
    if (!hasPrior) return;
  } catch {
    return;
  }

  // Best-effort; failures are swallowed. React Query/Dexie recover on the
  // next actual useQuery invocation.
  await Promise.allSettled([
    axios.get("/api/user/library").then((r) => cacheLibrary(r.data)),
    axios.get("/api/user/volume").then((r) => cacheAllVolumes(r.data)),
    axios.get("/api/user/settings").then((r) => cacheSettings(r.data)),
  ]);
}

function SettingsProvider({ children }) {
  const provider = useAuthProvider();
  const { data: settings } = useUserSettings();
  const merged = useMemo(
    () => ({ ...(provider ?? {}), ...(settings ?? {}) }),
    [provider, settings],
  );

  // Theme — apply to DOM + cache locally so cold-start picks the right
  // palette before React mounts.
  useEffect(() => {
    const pref = settings?.theme ?? "dark";
    applyThemePreference(pref);
    rememberThemePreference(pref);
  }, [settings?.theme]);

  // Language — stash the latest authoritative value in localStorage so the
  // next cold-start picks the right bundle synchronously (see I18nBoundary).
  useEffect(() => {
    if (settings?.language) rememberLanguage(settings.language);
  }, [settings?.language]);

  return (
    <SettingsContext.Provider value={merged}>
      {children}
    </SettingsContext.Provider>
  );
}

/**
 * Reads the language once at startup from localStorage, then follows live
 * settings updates. Wraps the rest of the tree in an I18nProvider so every
 * useT() call resolves against the right bundle from the very first render.
 */
function I18nBoundary({ children }) {
  const { data: settings } = useUserSettings();
  const [lang, setLang] = useState(bootstrapLanguage);

  useEffect(() => {
    const next = settings?.language;
    if (next && next !== lang) setLang(next);
  }, [settings?.language, lang]);

  return <I18nProvider lang={lang}>{children}</I18nProvider>;
}

function AppShell() {
  const location = useLocation();
  const { manga, adult_content_level } = location.state || {};
  const [googleUser, setGoogleUser] = useState(null);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname]);

  // 同期 · Realtime sync — opens a WebSocket as soon as we're auth'd
  // and invalidates TanStack queries on incoming events so changes
  // made on another device materialise here without a refresh.
  useRealtimeSync({ enabled: Boolean(googleUser) });

  return (
    <>
      <Header />
      <OfflineBanner />
      <SyncToaster />
      <main className="relative">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<About googleUser={googleUser} />} />
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
                  <MangaPage
                    manga={manga}
                    adult_content_level={adult_content_level}
                  />
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
            <Route
              path="/seals"
              element={
                <ProtectedRoute setGoogleUser={setGoogleUser}>
                  <SealsPage />
                </ProtectedRoute>
              }
            />
            {/* Public profile — deliberately outside ProtectedRoute so
                anonymous visitors can see the gallery. Server-side
                filters adult content + sensitive fields. */}
            <Route path="/u/:slug" element={<PublicProfile />} />
            {/* External imports — accessed from Settings → Archive. */}
            <Route
              path="/settings/import-external"
              element={
                <ProtectedRoute setGoogleUser={setGoogleUser}>
                  <ImportExternalPage />
                </ProtectedRoute>
              }
            />
            {/* 対照 · Compare — authenticated; diffs my library with a
                public profile slug. */}
            <Route
              path="/compare/:slug"
              element={
                <ProtectedRoute setGoogleUser={setGoogleUser}>
                  <ComparePage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </Suspense>
      </main>
    </>
  );
}

export default function App() {
  useEffect(() => {
    // Order matters: the connectivity watcher installs the axios interceptor
    // that feeds the sync runner's "is-server-reachable" signal.
    //
    // Both installers are idempotent via module-level guards (React
    // StrictMode's double-invocation in dev previously stacked two
    // axios interceptors + two 60s intervals — fixed with
    // `_connectivityInstalled` / `_syncRunnerInstalled` sentinels).
    // We still return teardown functions so hot-module-replacement
    // during a dev cycle doesn't leave dead subscribers around.
    const uninstallConn = installConnectivityWatcher();
    const uninstallSync = installSyncRunner();

    // Prime the Dexie cache in the background so the first internal nav is
    // instant. Uses requestIdleCallback to stay out of the critical path;
    // falls back to setTimeout on Safari (no rIC support).
    const schedule =
      typeof window !== "undefined" && "requestIdleCallback" in window
        ? (fn) => window.requestIdleCallback(fn, { timeout: 3000 })
        : (fn) => setTimeout(fn, 800);
    const handle = schedule(() => {
      prefetchCoreUserData();
    });

    return () => {
      if (typeof window !== "undefined" && "cancelIdleCallback" in window) {
        try {
          window.cancelIdleCallback(handle);
        } catch {
          /* noop */
        }
      } else {
        clearTimeout(handle);
      }
      // Only actually uninstalls in dev (HMR) — in prod the app
      // never unmounts and these runners persist for the page's
      // lifetime. Calling them is cheap either way.
      uninstallSync?.();
      uninstallConn?.();
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nBoundary>
        <SettingsProvider>
          <AppShell />
        </SettingsProvider>
      </I18nBoundary>
    </QueryClientProvider>
  );
}
