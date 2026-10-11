import {
  lazy,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  bootstrapLanguage,
  I18nProvider,
  loadAllNamespaces,
  loadLanguage,
  rememberLanguage,
  settleLanguage,
} from "@/i18n/index.jsx";

// Eager — always on screen, no point code-splitting these
import Header from "./components/Header";
import ProtectedRoute from "./components/ProtectedRoute";
import DefaultBackground from "@/components/DefaultBackground.jsx";
import OfflineBanner from "@/components/OfflineBanner.jsx";
import SyncToaster from "@/components/SyncToaster.jsx";
import SealsUnlockToaster from "@/components/SealsUnlockToaster.jsx";
import UpdatePrompt from "@/components/UpdatePrompt.jsx";
import PageLoader from "@/components/PageLoader.jsx";
import RouteErrorBoundary from "@/components/RouteErrorBoundary.jsx";

// 鍵 · CommandPalette + ShortcutsCheatSheet are gated behind global
// keypresses (`⌘K` and `?`) — they're never on screen at first paint.
// Lazy-loading them defers ~10 KB gzip from the main entry chunk to a
// post-mount fetch on the first user gesture, with no perceptible UX
// delay (the chunk is small and the fetch happens once per session).
// Wrapped in <Suspense fallback={null}> below so the chunk-load is
// invisible.
const CommandPalette = lazy(() => import("@/components/CommandPalette.jsx"));
// 筆 · The ink trail is opt-in (Settings → Apparence) and off for touch
// and reduced motion: its canvas loop has no business in the entry
// chunk that every visitor downloads.
const InkTrailCursor = lazy(() => import("@/components/ui/InkTrailCursor.jsx"));
const ShortcutsCheatSheet = lazy(
  () => import("@/components/ShortcutsCheatSheet.jsx"),
);

// 頁 · Routes — each page lands in its own chunk so first paint ships
// less, and each can be loaded before it renders (`routePages.js`), which
// is what spares a cold start the loading screen.
import {
  About,
  AddPage,
  AuthorPage,
  BacklogPage,
  CalendarPage,
  CollectionPage,
  ComparePage,
  Dashboard,
  FriendsPage,
  GlossaryPage,
  HelpPage,
  ImportExternalPage,
  InventoryPage,
  Login,
  MangaPageRoute,
  NotFoundPage,
  ProfilePage,
  PublicProfile,
  RangementPage,
  ScanPage,
  SealsPage,
  SettingsPage,
  ShelfStickersPage,
  SnapshotsPage,
  StatsPage,
  YearInReviewPage,
} from "./routePages.js";

import SettingsContext from "@/SettingsContext.js";
import { queryClient } from "@/lib/queryClient.js";
import { installConnectivityWatcher } from "@/lib/connectivity.js";
import { installSyncRunner } from "@/lib/sync.js";
import { applyThemePreference, rememberThemePreference } from "@/lib/theme.js";
import { applyAccentToDocument, rememberAccent } from "@/lib/accent.js";
import { setSoundEnabled } from "@/lib/sounds.js";
import { useAuth } from "@/hooks/useAuth.js";
import { useScrollMemory } from "@/hooks/useScrollMemory.js";
import { setCoverProxySession } from "@/lib/covers.js";
import { useAuthProvider } from "@/hooks/useAuthProvider.js";
import { useUserSettings } from "@/hooks/useSettings.js";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts.js";
import { useRealtimeSync } from "@/hooks/useRealtimeSync.js";
import { useTimeOfDay } from "@/hooks/useTimeOfDay.js";
import { db, SETTINGS_KEY } from "@/lib/db.js";
import {
  allVolumesQuery,
  libraryQuery,
  settingsQuery,
} from "@/lib/coreQueries.js";

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

  // Through the query client, under the keys the hooks use. Fetching
  // these with bare axios — as this did — meant React Query knew
  // nothing about the responses and asked for all three again as soon
  // as a page mounted: two of everything, and the volumes response is
  // a megabyte. `prefetchQuery` fills the same cache entry the hook
  // will read, so the hook either awaits this very promise or finds
  // the data fresh and asks for nothing.
  //
  // Errors are swallowed by `prefetchQuery` itself; the hooks recover.
  await Promise.allSettled([
    queryClient.prefetchQuery(libraryQuery),
    queryClient.prefetchQuery(allVolumesQuery),
    queryClient.prefetchQuery(settingsQuery),
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

const TEXT_WARM_KEY = "mc:i18n-warm";
const TEXT_WARM_DELAY_MS = 5000;

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

  // 分 · Once a language is on screen, page text is fetched for it alone.
  useEffect(() => {
    settleLanguage(lang);
  }, [lang]);

  // 分 · Each page brings its own text (`i18n/split.js`). Offline, a page
  // never opened online would have none — so once a reader's first screen
  // is up and the browser is idle, the rest of their language is fetched
  // and the service worker keeps it. Readers only: a visitor on the
  // landing, who has no settings, is not sent the whole catalogue.
  //
  // Once per deploy and language: the entry's own address changes with
  // every build that changes a catalogue chunk (their loaders live in
  // it), and the mark is only left when a service worker controls the
  // page — on a first visit it does not yet, and its cache would not
  // have kept what was fetched.
  //
  // And not before the page has finished loading, plus a few seconds:
  // started at the first idle moment, its thirty-odd small requests
  // landed in the middle of the first screen's own (65 requests before
  // the largest paint of /calendrier instead of 32, measured).
  const signedIn = settings != null;
  useEffect(() => {
    if (!signedIn || typeof window === "undefined") return undefined;
    if (navigator.onLine === false) return undefined;
    const stamp = `${lang} ${import.meta.url}`;
    try {
      if (localStorage.getItem(TEXT_WARM_KEY) === stamp) return undefined;
    } catch {
      /* storage blocked — warm it anyway */
    }
    const idle = window.requestIdleCallback ?? ((cb) => window.setTimeout(cb, 1000));
    const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout;
    let timer = null;
    let handle = null;
    const warm = () => {
      handle = idle(
        () => {
          loadAllNamespaces().then(
            () => {
              if (!navigator.serviceWorker?.controller) return;
              try {
                localStorage.setItem(TEXT_WARM_KEY, stamp);
              } catch {
                /* next start warms it again */
              }
            },
            () => {
              /* offline or a stale deploy — the pages load their own text */
            },
          );
        },
        { timeout: 15000 },
      );
    };
    const afterLoad = () => {
      timer = window.setTimeout(warm, TEXT_WARM_DELAY_MS);
    };
    if (document.readyState === "complete") afterLoad();
    else window.addEventListener("load", afterLoad, { once: true });
    return () => {
      window.removeEventListener("load", afterLoad);
      if (timer != null) window.clearTimeout(timer);
      if (handle != null) cancelIdle(handle);
    };
  }, [signedIn, lang]);

  return <I18nProvider lang={lang}>{children}</I18nProvider>;
}

/**
 * 錠 · Mounts its children only once we know there is a session.
 *
 * `AppShell` wraps every route, `/log-in` and the landing included, so
 * anything mounted in it runs for visitors who have no account at all.
 * The command palette searches your library and the seal notifier reads
 * your trophies; both fired their GETs at anonymous visitors, who got a
 * 401 apiece — an error in their console and a line in the operator's
 * log, on the one page where a newcomer is deciding whether to trust
 * the app.
 *
 * `useAuth` is the shared probe (one `/auth/user` for the whole tree),
 * and it answers `cached` rather than `unauthenticated` when the server
 * is merely unreachable, so an offline session keeps its overlays.
 */
function SignedInOnly({ children }) {
  const { status, isAuthenticated } = useAuth();
  // 影 · The cover relay answers a session and nothing else, so the
  // rewrite waits for one — an anonymous visitor on the landing would
  // otherwise buy a 401 per cover. See `lib/covers.js`.
  //
  // `checking` is not an answer. Writing `false` while the probe is in
  // flight switches the relay off for its duration — every cover that
  // mounts in that window goes straight to the CDN, which is the one
  // thing the relay exists to prevent — and a visit closed mid-probe
  // would leave the remembered flag cleared for the next one.
  useEffect(() => {
    if (status?.kind === "checking") return;
    setCoverProxySession(isAuthenticated);
  }, [status?.kind, isAuthenticated]);
  return isAuthenticated ? children : null;
}

/**
 * 筆 · Ink-trail gate — only mounts the canvas when the user has
 * opted in via Settings → Apparence → 筆 Traînée d'encre. Reading
 * the setting from `SettingsContext` keeps this in sync with the
 * rest of the UI and avoids an extra useUserSettings call. The
 * component itself does its own coarse-pointer / reduced-motion
 * checks, so the gate is upper-bound: false here = guaranteed off,
 * true here = honoured iff the device + motion preference allow.
 */
function InkTrailGate() {
  const { ink_trail_enabled } = useContext(SettingsContext);
  if (!ink_trail_enabled) return null;
  return (
    <Suspense fallback={null}>
      <InkTrailCursor />
    </Suspense>
  );
}

function AppShell() {
  const location = useLocation();
  const { manga, adult_content_level } = location.state || {};
  const [googleUser, setGoogleUser] = useState(null);
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);

  // 鍵 · `?` opens the cheat sheet, `g` chord navigates to a route.
  // The hook is mounted once at the shell level so the bindings are
  // available on every page. See `hooks/useGlobalShortcuts.js`.
  useGlobalShortcuts({ onOpenCheatSheet: () => setCheatSheetOpen(true) });

  // 時 · Time-of-day haze. Sets `data-tod` on <html> so body's
  // background picks up the right hour-tinted overlay. Inline
  // bootstrap in index.html primes the value at first paint;
  // this hook keeps it fresh as the wall clock advances.
  useTimeOfDay();

  // 戻 · Scroll: top on push/replace, each history entry's own remembered
  // position on pop — for every page, once the page can hold it. See
  // `hooks/useScrollMemory.js`; it also owns `history.scrollRestoration`.
  useScrollMemory();

  // 同期 · Realtime sync — opens a WebSocket as soon as we're auth'd
  // and invalidates TanStack queries on incoming events so changes
  // made on another device materialise here without a refresh.
  useRealtimeSync({ enabled: Boolean(googleUser) });

  return (
    <>
      <Header />
      <OfflineBanner />
      <SyncToaster />
      {/* 印鑑 · Seal-unlock notifier — listens to realtime sync
          events for kinds that could move a seal threshold and
          fires a click-to-/seals toast through the same SyncToaster
          shell. Behind `SignedInOnly` so its GET /api/user/seals is
          only ever fired for a logged-in user: `AppShell` itself is
          not auth-gated, it wraps the landing and /log-in too. */}
      <SignedInOnly>
        <SealsUnlockToaster />
      </SignedInOnly>
      {/* 筆 · Ink-trail cursor — paints a trailing brush line
          over headings marked `data-ink-trail`. Off by default;
          users opt in from Settings → Apparence. The component
          also self-disables on coarse-pointer devices and when
          `prefers-reduced-motion: reduce` is requested, so the
          visible toggle is upper-bound only. */}
      <InkTrailGate />
      {/* Keypress-gated overlays — wrapped in their own Suspense so a
          chunk-load failure (offline at the moment of first ⌘K) doesn't
          crash the whole tree. `fallback={null}` is intentional: the
          first ⌘K press has nothing to show during the network fetch,
          and the second press will hit the cached chunk and open
          instantly. */}
      <Suspense fallback={null}>
        {/* Searches your library and jumps to protected routes — there
            is nothing for it to offer a visitor who is not signed in,
            and mounting it asked for their library and got a 401. */}
        <SignedInOnly>
          <CommandPalette />
        </SignedInOnly>
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
                path="/profile"
                element={
                  <ProtectedRoute setGoogleUser={setGoogleUser}>
                    <ProfilePage googleUser={googleUser} />
                  </ProtectedRoute>
                }
              />
              {/* 帳 · Deep-dive analytics ledger — sibling of
                /profile, opened from the "Voir toutes les
                statistiques" CTA on the slim profile hero. */}
              <Route
                path="/stats"
                element={
                  <ProtectedRoute setGoogleUser={setGoogleUser}>
                    <StatsPage />
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
                path="/scan"
                element={
                  <ProtectedRoute setGoogleUser={setGoogleUser}>
                    <DefaultBackground>
                      <ScanPage />
                    </DefaultBackground>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/rangement"
                element={
                  <ProtectedRoute setGoogleUser={setGoogleUser}>
                    <DefaultBackground>
                      <RangementPage />
                    </DefaultBackground>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/inventaire"
                element={
                  <ProtectedRoute setGoogleUser={setGoogleUser}>
                    <DefaultBackground>
                      <InventoryPage />
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
              <Route path="/aide" element={<HelpPage />} />
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
              {/* 印影 · Snapshot history gallery. */}
              <Route
                path="/snapshots"
                element={
                  <ProtectedRoute setGoogleUser={setGoogleUser}>
                    <SnapshotsPage />
                  </ProtectedRoute>
                }
              />
              {/* 友 · Friends feed — follow other archivists, see their
                public-profile activity in a chronological correspondence. */}
              <Route
                path="/friends"
                element={
                  <ProtectedRoute setGoogleUser={setGoogleUser}>
                    <FriendsPage />
                  </ProtectedRoute>
                }
              />
              {/* 出版 · Per-publisher filtered library view. The slug
                is the URL-encoded publisher string (free-text on
                user_libraries.publisher); pure client-side filter. */}
              <Route
                path="/publisher/:name"
                element={
                  <ProtectedRoute setGoogleUser={setGoogleUser}>
                    <CollectionPage kind="publisher" />
                  </ProtectedRoute>
                }
              />
              {/* 版 · Per-edition filtered library view. Same shape
                as /publisher/:name but filters on the `edition`
                column (Standard / Kanzenban / Deluxe / etc.). */}
              <Route
                path="/edition/:name"
                element={
                  <ProtectedRoute setGoogleUser={setGoogleUser}>
                    <CollectionPage kind="edition" />
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
              {/* 月 · The same poster over one month — `:month` is
                1-based, and anything else falls back to the year. */}
              <Route
                path="/year-in-review/:year/:month"
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
              {/* 迷子 · Catch-all 404. MUST stay last in the route list
                — React Router matches top-down and `*` matches any
                pathname that wasn't claimed by a more specific
                route above. Auth-agnostic on purpose: visitors who
                mistype a URL while logged out should still see the
                friendly page rather than a redirect dance. */}
              <Route path="*" element={<NotFoundPage />} />
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
          {/* 更 · Service-worker update banner. Mounted as a
              sibling of AppShell so it survives every route
              change and stays anchored bottom-right regardless
              of the page layout. The component self-hides when
              there's nothing to prompt — zero visual cost in
              the steady state. */}
          <UpdatePrompt />
        </SettingsProvider>
      </I18nBoundary>
    </QueryClientProvider>
  );
}
