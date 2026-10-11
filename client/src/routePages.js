import { lazyRoute } from "@/lib/lazyRoute.js";
import { loadNamespaces } from "@/i18n/index.jsx";
import { PAGE_NAMESPACES } from "@/i18n/split.js";

/*
 * 頁 · The pages the router renders, each in its own chunk, each
 * loadable ahead of its render (`lib/lazyRoute.js`).
 *
 * `main.jsx` loads the page the address names before the first render,
 * so a cold start draws it straight away instead of a loading screen
 * that React then keeps up for 300 ms; `lib/prefetch.js` loads the
 * pages a link leads to when the link is hovered, focused or touched.
 *
 * Each page also brings its own text: the catalogue chunks
 * `i18n/split.js` lists for it are loaded with the module, and the page
 * renders once both are there.
 *
 * `PAGE_PATHS` is the same table `vite.config.js` (`ROUTE_MODULES`)
 * turns into `<link rel="modulepreload">` tags for the first request —
 * `routePages.test.js` keeps the two in step. A key ending in `/` is a
 * prefix: `/author/` stands for every `/author/:malId`.
 */
function page(name, factory) {
  const chunks = PAGE_NAMESPACES[name];
  if (!chunks) throw new Error(`routePages: "${name}" has no row in i18n/split.js`);
  return lazyRoute(factory, chunks.length ? { before: () => loadNamespaces(chunks) } : undefined);
}

export const About = page("About", () => import("./components/About.jsx"));
export const Login = page("Login", () => import("./components/Login.jsx"));
export const Dashboard = page("Dashboard", () => import("./components/Dashboard.jsx"));
export const MangaPageRoute = page("MangaPageRoute", () => import("./components/MangaPageRoute.jsx"));
export const AddPage = page("AddPage", () => import("./components/AddPage.jsx"));
export const ProfilePage = page("ProfilePage", () => import("./components/ProfilePage.jsx"));
export const StatsPage = page("StatsPage", () => import("./components/StatsPage.jsx"));
export const SettingsPage = page("SettingsPage", () => import("./components/SettingsPage.jsx"));
export const SealsPage = page("SealsPage", () => import("./components/SealsPage.jsx"));
export const PublicProfile = page("PublicProfile", () => import("./components/PublicProfile.jsx"));
export const ImportExternalPage = page("ImportExternalPage", () => import("./components/ImportExternalPage.jsx"));
export const ComparePage = page("ComparePage", () => import("./components/ComparePage.jsx"));
export const YearInReviewPage = page("YearInReviewPage", () => import("./components/YearInReviewPage.jsx"));
export const ShelfStickersPage = page("ShelfStickersPage", () => import("./components/ShelfStickersPage.jsx"));
// 番 · Global scanner — shelf lookup first, add flow second.
export const ScanPage = page("ScanPage", () => import("./components/ScanPage.jsx"));
// 棚 · Places and stock-taking — the physical side of the shelf.
export const RangementPage = page("RangementPage", () => import("./components/RangementPage.jsx"));
export const InventoryPage = page("InventoryPage", () => import("./components/InventoryPage.jsx"));
// 助 · The help page — its prose is fetched with it, not bundled.
export const HelpPage = page("HelpPage", () => import("./components/HelpPage.jsx"));
export const GlossaryPage = page("GlossaryPage", () => import("./components/GlossaryPage.jsx"));
export const CalendarPage = page("CalendarPage", () => import("./components/CalendarPage.jsx"));
export const AuthorPage = page("AuthorPage", () => import("./components/AuthorPage.jsx"));
export const BacklogPage = page("BacklogPage", () => import("./components/BacklogPage.jsx"));
export const SnapshotsPage = page("SnapshotsPage", () => import("./components/SnapshotsPage.jsx"));
export const FriendsPage = page("FriendsPage", () => import("./components/FriendsPage.jsx"));
export const CollectionPage = page("CollectionPage", () => import("./components/CollectionPage.jsx"));
// 迷子 · 404 — a low-frequency surface, never preloaded.
export const NotFoundPage = page("NotFoundPage", () => import("./components/NotFoundPage.jsx"));

export const PAGE_PATHS = {
  "/": About,
  "/log-in": Login,
  "/dashboard": Dashboard,
  "/mangapage": MangaPageRoute,
  "/addmanga": AddPage,
  "/profile": ProfilePage,
  "/stats": StatsPage,
  "/settings": SettingsPage,
  "/settings/import-external": ImportExternalPage,
  "/settings/shelf-stickers": ShelfStickersPage,
  "/calendrier": CalendarPage,
  "/scan": ScanPage,
  "/backlog": BacklogPage,
  "/rangement": RangementPage,
  "/inventaire": InventoryPage,
  "/seals": SealsPage,
  "/friends": FriendsPage,
  "/snapshots": SnapshotsPage,
  "/year-in-review": YearInReviewPage,
  "/year-in-review/": YearInReviewPage,
  "/aide": HelpPage,
  "/glossary": GlossaryPage,
  "/u/": PublicProfile,
  "/author/": AuthorPage,
  "/publisher/": CollectionPage,
  "/edition/": CollectionPage,
  "/compare/": ComparePage,
};

/** The page `pathname` renders, or null for one the table does not know. */
export function pageForPath(pathname) {
  if (typeof pathname !== "string") return null;
  // A prefix key is not a page of its own: `/author/` alone is a 404.
  const exact = PAGE_PATHS[pathname];
  if (exact && (pathname === "/" || !pathname.endsWith("/"))) return exact;
  let best = null;
  for (const key of Object.keys(PAGE_PATHS)) {
    if (!key.endsWith("/") || key === "/") continue;
    if (pathname.startsWith(key) && pathname.length > key.length) {
      if (!best || key.length > best.length) best = key;
    }
  }
  return best ? PAGE_PATHS[best] : null;
}

/**
 * Load the page `pathname` renders. Resolves once it can render without
 * suspending; never rejects (a failed load is retried by the render,
 * which reports it). Null for a path the table does not know.
 */
export function preloadPageFor(pathname) {
  const page = pageForPath(pathname);
  if (!page) return null;
  return page.preload().then(
    () => true,
    () => false,
  );
}
