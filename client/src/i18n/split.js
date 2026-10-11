/*
 * 分 · Which parts of a catalogue ship with the pages that use them
 * instead of with the language.
 *
 * The catalogues are still written one file per language (`en.js`,
 * `fr.js`, `es.js`) and `parity.test.js` still holds them to the same
 * keys. At build time `plugins/i18n-split.js` cuts each one in two:
 *
 *   - the core — every namespace not listed below — loaded before the
 *     first render, because the shell itself speaks it (navigation,
 *     sync toasts, seals, the series cards…);
 *   - one small chunk per entry of `NAMESPACE_CHUNKS`, loaded with the
 *     pages that name it in `PAGE_NAMESPACES` (`routePages.js` waits for
 *     them before rendering the page, `index.html` modulepreloads them
 *     for the address it is opened on).
 *
 * The whole English catalogue was 34.5 kB gzipped on the critical path
 * of every page, and half of it was one page's text: the settings, the
 * glossary, the landing, the welcome tour, the import screen…
 *
 * `split.test.js` reads the import graph and fails when a component
 * using a namespace below can be reached without going through a page
 * that loads it — the mistake this file makes possible, and the only
 * one: a namespace not listed here simply stays in the core.
 *
 * Plain data, no imports: the Vite plugin reads it in Node.
 */

/** The catalogues there are, by code. */
export const CATALOGUE_LANGS = ["en", "fr", "es"];

/** Chunk name → the top-level namespaces it carries. */
export const NAMESPACE_CHUNKS = {
  // One page each.
  settings: ["settings", "deleteAccount"],
  glossary: ["glossary"],
  about: ["about"],
  importExternal: ["importExternal"],
  calendar: ["calendar", "calendarSubscribe"],
  dashboard: ["dashboard", "bulk", "season", "gap"],
  analytics: ["analytics"],
  snapshots: ["snapshots"],
  rangement: ["rangement"],
  add: ["add", "share", "mangadexPrefill"],
  publicProfile: ["publicProfile"],
  compare: ["compare"],
  inventory: ["inventory"],
  yearReview: ["yearReview"],
  backlog: ["backlog"],
  collection: ["collection"],
  login: ["login"],
  notFound: ["notFound"],
  scanPage: ["scanPage"],
  help: ["help"],
  mangaPage: ["coverPicker"],
  profilePage: ["activity", "recs", "avatar", "snapshot"],
  // Shared by a few pages.
  stats: ["stats"],
  tour: ["tour"],
  volume: ["volume"],
  scan: ["scan"],
  profile: ["profile"],
  labels: ["labels"],
  loans: ["loans"],
  coffret: ["coffret"],
  friends: ["friends"],
  shelfStickers: ["shelfStickers"],
};

/**
 * Page (its module under `src/components`, without the extension) → the
 * chunks it needs. Every page `routePages.js` lazy-loads has a row, even
 * an empty one, so a new page is a decision rather than an omission.
 */
export const PAGE_NAMESPACES = {
  About: ["about"],
  Login: ["login"],
  Dashboard: ["dashboard", "tour", "loans"],
  MangaPageRoute: ["mangaPage", "volume", "labels", "loans", "coffret"],
  AddPage: ["add", "coffret", "scan"],
  ProfilePage: ["profilePage", "stats", "tour", "scan", "profile"],
  StatsPage: ["stats", "analytics", "volume", "profile"],
  SettingsPage: ["settings", "tour", "shelfStickers"],
  SealsPage: [],
  PublicProfile: ["publicProfile", "friends"],
  ImportExternalPage: ["importExternal"],
  ComparePage: ["compare"],
  YearInReviewPage: ["yearReview", "profile"],
  ShelfStickersPage: ["shelfStickers"],
  ScanPage: ["scanPage", "scan"],
  RangementPage: ["rangement", "volume", "labels", "scan"],
  InventoryPage: ["inventory", "volume", "scan"],
  HelpPage: ["help"],
  GlossaryPage: ["glossary"],
  CalendarPage: ["calendar"],
  AuthorPage: [],
  BacklogPage: ["backlog"],
  SnapshotsPage: ["snapshots"],
  FriendsPage: ["friends"],
  CollectionPage: ["collection"],
  NotFoundPage: ["notFound"],
};
