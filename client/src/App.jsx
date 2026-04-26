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
import { readScroll, saveScroll } from "@/lib/scrollStore.js";
import {
  bootstrapLanguage,
  I18nProvider,
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
// 収 — year-in-review poster page; lazy because it's only visited
// occasionally (typically a few times in December / January).
const YearInReviewPage = lazy(() => import("./components/YearInReviewPage"));
// 札 — shelf-sticker printer; lazy because it's a one-off setup tool,
// not a daily-use surface. Pulls qrcode.react with it.
const ShelfStickersPage = lazy(() =>
  import("./components/ShelfStickersPage"),
);
// 字典 — public reference page; no auth needed.
const GlossaryPage = lazy(() => import("./components/GlossaryPage.jsx"));
// 暦 — upcoming-release calendar.
const CalendarPage = lazy(() => import("@/components/CalendarPage.jsx"));

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

/**
 * 巻 · MangaPage hydration shim.
 *
 * The `/mangapage` route historically receives its `manga` row through
 * React Router's `location.state` (set by Dashboard / Library cards on
 * navigation). That works for in-app links but BREAKS for any deep
 * link — refreshes, bookmarks, and most importantly QR codes scanned
 * off printed shelf stickers — because external entry points carry no
 * router state.
 *
 * This shim layers a fallback path: when `location.state.manga` is
 * absent, we read `?mal_id=` from the URL and resolve the row from the
 * Dexie-backed library cache. Three branches:
 *   1. state has the row     → render immediately (existing path).
 *   2. state empty + mal_id  → look up; render once Dexie answers.
 *   3. state empty + no mal_id OR not in library → redirect to
 *      `/dashboard` (a deep link to a series the user doesn't own
 *      isn't actionable here).
 *
 * Keeping this as a thin wrapper means MangaPage itself stays unaware
 * of routing concerns and can keep its `manga` prop contract.
 */
function MangaPageRoute({ stateManga, adult_content_level }) {
  const [searchParams] = useSearchParams();
  const malIdParam = searchParams.get("mal_id");
  const malId = malIdParam ? Number.parseInt(malIdParam, 10) : null;

  const { data: library, isInitialLoad: libLoading } = useLibrary();

  // Fast path — the in-app navigation case where state was populated.
  if (stateManga) {
    return (
      <MangaPage manga={stateManga} adult_content_level={adult_content_level} />
    );
  }

  // No state, no query → nowhere to go.
  if (!Number.isFinite(malId)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Wait for Dexie before deciding to redirect — a fresh tab opening
  // the deep link races library hydration against this render.
  if (libLoading) {
    return null; // PageLoader from outer Suspense covers visual gap
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

  // 巻戻し · Smart scroll handling on navigation.
  //
  //   PUSH / REPLACE (forward navigation, e.g. clicking a card)
  //     → scroll to top of the new page, the canonical SPA behaviour.
  //
  //   POP (back / forward via the browser's history controls)
  //     → restore the position saved for that history entry, so the
  //       user lands exactly where they were before they navigated
  //       away. Falls back to top when there's no recorded position
  //       (first POP after a hard reload, key never seen before).
  //
  // We disable the browser's auto scroll-restoration once on mount so
  // it doesn't race our own restore. The `location.key` is the stable
  // identifier React Router mints per history entry.
  useLayoutEffect(() => {
    if (typeof window === "undefined" || !window.history) return;
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useLayoutEffect(() => {
    if (navType !== "POP") {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      return undefined;
    }

    const targetY = readScroll(location.key);
    if (!targetY || targetY <= 0) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      return undefined;
    }

    // 巻戻し · Restore loop with content-grown observer.
    //
    // The naive "rAF then scrollTo" pattern fights an async data race:
    // pages like Dashboard read their data via Dexie's `useLiveQuery`,
    // which returns `undefined` on the first render and resolves a few
    // dozen ms later. At first paint the document is short (header
    // only), so a `scrollTo(savedY)` to a position deep inside the
    // (eventual) library grid is clamped to the bottom of the still-
    // empty page.
    //
    // The remedy: try once now, and keep retrying as `<body>` grows
    // — every time the document gets taller, ResizeObserver fires and
    // we re-attempt the scroll. We bail when:
    //   - the document is finally tall enough that `targetY` lands
    //     inside it (no more clamping), OR
    //   - 2 seconds elapse (safety net for pages that genuinely never
    //     reach that height — e.g. the user's library shrank since
    //     they left).
    const isTallEnough = () =>
      document.documentElement.scrollHeight - window.innerHeight >= targetY;

    let restored = false;
    const tryRestore = () => {
      if (restored) return true;
      window.scrollTo({ top: targetY, left: 0, behavior: "instant" });
      // Sample post-scroll: if Y stuck at the requested value, the
      // document was tall enough and we're done. Otherwise keep the
      // observer alive for the next resize.
      if (window.scrollY >= targetY - 4 || isTallEnough()) {
        restored = true;
        return true;
      }
      return false;
    };

    // First attempt on the very next paint.
    let raf = requestAnimationFrame(tryRestore);

    const ro = new ResizeObserver(() => {
      if (!restored) tryRestore();
    });
    ro.observe(document.documentElement);

    const giveUpTimer = setTimeout(() => {
      if (!restored) {
        // Last-chance scroll. We may still clamp short — that's
        // acceptable as a fallback (e.g. the underlying list is now
        // empty). 2 s is generous for typical Dexie + lazy-chunk
        // hydration without being noticeable to the user.
        window.scrollTo({ top: targetY, left: 0, behavior: "instant" });
        restored = true;
      }
      ro.disconnect();
    }, 2000);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      clearTimeout(giveUpTimer);
    };
  }, [location.key, navType]);

  // Save the current scroll position against the current history
  // entry's key — throttled via rAF so a heavy scroll doesn't write
  // hundreds of times per second. The store is in-memory only
  // (see lib/scrollStore.js), so no storage I/O cost.
  //
  // ## Why useLayoutEffect (not useEffect)
  //
  // React runs ALL layout-effect cleanups (reverse declaration order)
  // BEFORE running new layout effects (declaration order). The
  // restoration effect above is a layout effect that calls
  // `window.scrollTo(0, 0)` on PUSH navigation. If the save effect
  // were a regular `useEffect`, its cleanup would fire AFTER the
  // restoration effect — at which point `window.scrollY` is already
  // 0, and we'd persist that 0 under the outgoing page's key,
  // wiping the user's actual scroll position. As a sibling layout
  // effect, the save cleanup runs in the same synchronous phase
  // BEFORE the restore, capturing the user's still-intact scroll.
  useLayoutEffect(() => {
    let pending = false;
    const onScroll = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        saveScroll(location.key, window.scrollY);
        pending = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      // Captures the outgoing page's final scroll position — runs
      // synchronously before the new layout effects (including the
      // restore above) overwrite `scrollY`.
      saveScroll(location.key, window.scrollY);
      window.removeEventListener("scroll", onScroll);
    };
  }, [location.key]);

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
