import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigationType,
  useSearchParams,
} from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  bootstrapLanguage,
  I18nProvider,
  loadLanguage,
  rememberLanguage,
} from "@/i18n/index.jsx";
import { useLibrary } from "@/hooks/useLibrary.js";

// Eager — always on screen, no point code-splitting these
import Header from "./components/Header";
import ProtectedRoute from "./components/ProtectedRoute";
import DefaultBackground from "@/components/DefaultBackground.jsx";
import OfflineBanner from "@/components/OfflineBanner.jsx";
import SyncToaster from "@/components/SyncToaster.jsx";
import PageLoader from "@/components/PageLoader.jsx";
import RouteErrorBoundary from "@/components/RouteErrorBoundary.jsx";
import MangaPageSkeleton from "@/components/MangaPageSkeleton.jsx";

// 鍵 · CommandPalette + ShortcutsCheatSheet are gated behind global
// keypresses (`⌘K` and `?`) — they're never on screen at first paint.
// Lazy-loading them defers ~10 KB gzip from the main entry chunk to a
// post-mount fetch on the first user gesture, with no perceptible UX
// delay (the chunk is small and the fetch happens once per session).
// Wrapped in <Suspense fallback={null}> below so the chunk-load is
// invisible.
const CommandPalette = lazy(() => import("@/components/CommandPalette.jsx"));
const ShortcutsCheatSheet = lazy(() =>
  import("@/components/ShortcutsCheatSheet.jsx"),
);

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
const YearInReviewPage = lazy(() => import("./components/YearInReviewPage"));
const ShelfStickersPage = lazy(() =>
  import("./components/ShelfStickersPage"),
);
const GlossaryPage = lazy(() => import("./components/GlossaryPage.jsx"));
const CalendarPage = lazy(() => import("@/components/CalendarPage.jsx"));
const AuthorPage = lazy(() => import("./components/AuthorPage.jsx"));
const BacklogPage = lazy(() => import("./components/BacklogPage.jsx"));

import SettingsContext from "@/SettingsContext.js";
import { queryClient } from "@/lib/queryClient.js";
import { installConnectivityWatcher } from "@/lib/connectivity.js";
import { installSyncRunner } from "@/lib/sync.js";
import { applyThemePreference, rememberThemePreference } from "@/lib/theme.js";
import { applyAccentToDocument, rememberAccent } from "@/lib/accent.js";
import { setSoundEnabled } from "@/lib/sounds.js";
import { useAuthProvider } from "@/hooks/useAuthProvider.js";
import { useUserSettings } from "@/hooks/useSettings.js";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts.js";
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

  // 朱 · Accent — same cold-start mirror pattern. Falls back to the
  // baked-in shu (hanko) tokens when unset; clearing the localStorage
  // mirror at the same time avoids a stale reapply on the next visit.
  //
  // Critical: the early-return on `accent === undefined` distinguishes
  // "settings not loaded yet" from "loaded with the default (null)
  // accent". Without it, the first render of this component (before
  // useUserSettings has resolved from Dexie / network) would call
  // `applyAccentToDocument(null)` → `removeAttribute("data-accent")`
  // → the inline bootstrap's setting evaporates → the page flashes
  // back to the default `:root` red until settings lands and the
  // effect fires a second time. `null` (Dexie row exists but
  // accent_color is null) IS a valid state we want to honour — it
  // means the user picked the default — and we still drop the
  // attribute in that case. Only `undefined` (still loading) is
  // skipped.
  useEffect(() => {
    const accent = settings?.accent_color;
    if (accent === undefined) return;
    applyAccentToDocument(accent);
    rememberAccent(accent);
  }, [settings?.accent_color]);

  // Language — stash the latest authoritative value in localStorage so the
  // next cold-start picks the right bundle synchronously (see I18nBoundary).
  useEffect(() => {
    if (settings?.language) rememberLanguage(settings.language);
  }, [settings?.language]);

  // 音 · Mirror the DB-stored sound flag into the sounds module's
  // local cache so call sites can early-out without subscribing to
  // settings. Defaults to false (sound is opt-in).
  useEffect(() => {
    setSoundEnabled(Boolean(settings?.sound_enabled));
  }, [settings?.sound_enabled]);

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
    if (!next || next === lang) return;
    // Bundles are lazy: ensure the new language's chunk is in cache
    // before flipping the provider, otherwise the first render after
    // the switch would fall back to the raw key strings.
    let cancelled = false;
    loadLanguage(next).then(() => {
      if (!cancelled) setLang(next);
    });
    return () => {
      cancelled = true;
    };
  }, [settings?.language, lang]);

  return <I18nProvider lang={lang}>{children}</I18nProvider>;
}

/**
 * Hydrates the `manga` prop for `/mangapage` so deep links work.
 *
 * Internal navigations push a Manga row in `location.state.manga`.
 * Deep links (refresh, bookmark, QR scan) carry no state — fall back
 * to `?mal_id=` and look the row up in the Dexie-cached library. If
 * neither yields a row, redirect to /dashboard.
 */
function MangaPageRoute({ stateManga, adult_content_level }) {
  const [searchParams] = useSearchParams();
  const malIdParam = searchParams.get("mal_id");
  const malId = malIdParam ? Number.parseInt(malIdParam, 10) : null;

  const { data: library, isInitialLoad: libLoading } = useLibrary();

  if (stateManga) {
    return (
      <MangaPage manga={stateManga} adult_content_level={adult_content_level} />
    );
  }

  if (!Number.isFinite(malId)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Wait for Dexie before deciding the row doesn't exist — a fresh tab
  // races hydration against this render. Skeleton mirrors the hero
  // layout so the swap to real data is a crossfade-in-place rather
  // than a "blank → content" pop.
  if (libLoading) {
    return <MangaPageSkeleton />;
  }

  const resolved = library?.find((m) => m.mal_id === malId);
  if (!resolved) {
    return <Navigate to="/dashboard" replace />;
  }
  return (
    <MangaPage manga={resolved} adult_content_level={adult_content_level} />
  );
}

function AppShell() {
  const location = useLocation();
  const navType = useNavigationType();
  const { manga, adult_content_level } = location.state || {};
  const [googleUser, setGoogleUser] = useState(null);
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);

  // 鍵 · `?` opens the cheat sheet, `g` chord navigates to a route.
  // The hook is mounted once at the shell level so the bindings are
  // available on every page. See `hooks/useGlobalShortcuts.js`.
  useGlobalShortcuts({ onOpenCheatSheet: () => setCheatSheetOpen(true) });

  // Scroll handling: top on PUSH/REPLACE; on POP we leave it alone so
  // each destination page can run its own data-aware restore (see
  // Dashboard.jsx). Browser auto-restoration is disabled because it
  // fires before our data hydration and would clamp short.
  useLayoutEffect(() => {
    if (typeof window === "undefined" || !window.history) return;
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useLayoutEffect(() => {
    if (navType === "POP") return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.key, navType]);

  // 同期 · Realtime sync — opens a WebSocket as soon as we're auth'd
  // and invalidates TanStack queries on incoming events so changes
  // made on another device materialise here without a refresh.
  useRealtimeSync({ enabled: Boolean(googleUser) });

  return (
    <>
      <Header />
      <OfflineBanner />
      <SyncToaster />
      {/* Keypress-gated overlays — wrapped in their own Suspense so a
          chunk-load failure (offline at the moment of first ⌘K) doesn't
          crash the whole tree. `fallback={null}` is intentional: the
          first ⌘K press has nothing to show during the network fetch,
          and the second press will hit the cached chunk and open
          instantly. */}
      <Suspense fallback={null}>
        <CommandPalette />
        <ShortcutsCheatSheet
          open={cheatSheetOpen}
          onClose={() => setCheatSheetOpen(false)}
        />
      </Suspense>
      <main className="relative">
        {/* 災 · ErrorBoundary outside Suspense so a chunk-load failure
            (deploy invalidated cached chunks, offline burst, …) shows
            a graceful "couldn't load" panel instead of crashing the
            whole tree. Same boundary catches runtime crashes inside
            any lazy route. Boundary is reset by a hard reload, the
            only reliable way to re-fetch a missing chunk. */}
        <RouteErrorBoundary>
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
                  <MangaPageRoute
                    stateManga={manga}
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
            {/* 暦 · Upcoming-release calendar — Agenda + Month grid
                fed by `/api/user/calendar/upcoming`. Auth-required
                because the data is per-user, even though the
                announcement source itself (MangaUpdates) is public. */}
            <Route
              path="/calendrier"
              element={
                <ProtectedRoute setGoogleUser={setGoogleUser}>
                  <CalendarPage />
                </ProtectedRoute>
              }
            />
            {/* Public profile — deliberately outside ProtectedRoute so
                anonymous visitors can see the gallery. Server-side
                filters adult content + sensitive fields. */}
            <Route path="/u/:slug" element={<PublicProfile />} />
            <Route path="/glossary" element={<GlossaryPage />} />
            {/* 作家 · Per-author detail — reverse-lookup of all your
                series by the same mangaka. The slug is the author's
                mal_id (the synthetic identifier the FK refactor
                introduced): positive for shared MAL rows, negative
                for custom per-user rows. Routing by id sidesteps
                URL-encoding and case-folding gotchas, and the page
                can JOIN the library by `author.mal_id` directly.
                Authenticated since it reads the personal library. */}
            <Route
              path="/author/:malId"
              element={
                <ProtectedRoute setGoogleUser={setGoogleUser}>
                  <AuthorPage />
                </ProtectedRoute>
              }
            />
            {/* 山積 · Backlog audit — owned-but-unread analytics. Pure
                client read from Dexie, works offline. */}
            <Route
              path="/backlog"
              element={
                <ProtectedRoute setGoogleUser={setGoogleUser}>
                  <BacklogPage />
                </ProtectedRoute>
              }
            />
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
            {/* 収 · Year-in-review poster — authenticated. The :year
                segment is optional via the second route; default
                resolution to current year happens in the page. */}
            <Route
              path="/year-in-review"
              element={
                <ProtectedRoute setGoogleUser={setGoogleUser}>
                  <YearInReviewPage googleUser={googleUser} />
                </ProtectedRoute>
              }
            />
            <Route
              path="/year-in-review/:year"
              element={
                <ProtectedRoute setGoogleUser={setGoogleUser}>
                  <YearInReviewPage googleUser={googleUser} />
                </ProtectedRoute>
              }
            />
            {/* 札 · Shelf stickers — print sheet of QR-coded series
                labels for the user's physical bookshelf. Authenticated
                because it lists the user's library. */}
            <Route
              path="/settings/shelf-stickers"
              element={
                <ProtectedRoute setGoogleUser={setGoogleUser}>
                  <ShelfStickersPage />
                </ProtectedRoute>
              }
            />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
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
