import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import Manga from "./Manga";
import DefaultBackground from "./DefaultBackground";
import MangaSearchBar from "./MangaSearchBar";
import GapSuggestions from "./GapSuggestions.jsx";
import { FilterButton, ActiveChips } from "./TagFilter.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import WelcomeTour from "./WelcomeTour.jsx";
import SeasonGreeting from "./SeasonGreeting.jsx";
import { hasSeenTour } from "@/lib/tour.js";
import SettingsContext from "@/SettingsContext.js";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";
import { filterAdultGenreIfNeeded } from "@/utils/library.js";
import { useT } from "@/i18n/index.jsx";

// 段 · Library pagination — paint up to 30 cards on first render and
// extend by another 30 each time the bottom-of-grid sentinel scrolls
// into view. A flat library of 200+ series otherwise renders 200 DOM
// nodes + 200 cover images on mount, which on low-end mobile causes a
// visible scroll lag and ~150 MB of RAM held by decoded image bitmaps.
// At the 30-page step the eye barely registers the load — by the time
// the sentinel's intersection callback fires, React already has 30
// fresh cards painted.
const LIBRARY_PAGE_SIZE = 30;

// 巻戻し · sessionStorage key for the dashboard's transient state
// (filter / query / activeTags / visibleCount). Persisted so a back-
// navigation from MangaPage lands the user on the same view they
// left — same filter, same scroll-loaded cards, same tag selection.
// sessionStorage (not localStorage) on purpose: the state is per-tab
// and shouldn't leak across browser sessions.
const DASHBOARD_STATE_KEY = "mc:dashboard:view";

function readPersistedDashboardState() {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(DASHBOARD_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      query: typeof parsed.query === "string" ? parsed.query : "",
      filter: typeof parsed.filter === "string" ? parsed.filter : "all",
      activeTags: Array.isArray(parsed.activeTags) ? parsed.activeTags : [],
      visibleCount:
        Number.isFinite(parsed.visibleCount) && parsed.visibleCount > 0
          ? parsed.visibleCount
          : LIBRARY_PAGE_SIZE,
    };
  } catch {
    return null;
  }
}

function writePersistedDashboardState(state) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(DASHBOARD_STATE_KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

export default function Dashboard() {
  // Single read of the persisted state at mount time — used to seed
  // every piece of view state below. Subsequent state changes are
  // each individually persisted in their own effect.
  const persisted = useMemo(() => readPersistedDashboardState(), []);

  const [query, setQuery] = useState(() => persisted?.query ?? "");
  const [filter, setFilter] = useState(() => persisted?.filter ?? "all");
  // filter ∈ "all" | "inprogress" | "wishlist" | "complete" | "tsundoku"
  //   inprogress → at least one owned volume but not all (vraiment "en cours")
  //   wishlist   → tracked but zero volumes acquired (願 · negai)
  //   complete   → every tracked volume owned
  //   tsundoku   → at least one owned-but-unread volume
  // The filters are mutually exclusive; "inprogress" used to also catch
  // wishlist series (owned === 0), which made the ladder ambiguous. The
  // new contract gives wishlist its own bucket.
  // Genre filter — Set<string>. Multi-select with AND intersection (series
  // must carry every selected tag to remain visible). Kept as Set for O(1)
  // membership checks in the hot filter path below.
  const [activeTags, setActiveTags] = useState(
    () => new Set(persisted?.activeTags ?? []),
  );
  const { adult_content_level } = useContext(SettingsContext);
  const navigate = useNavigate();
  const t = useT();

  const toggleTag = useCallback((name) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const clearTags = useCallback(() => setActiveTags(new Set()), []);

  const { data: rawLibrary, isInitialLoad, isEmpty } = useLibrary();
  const { data: allVolumes } = useAllVolumes();

  // 始 · Welcome tour gating.
  // Auto-open on the first dashboard visit when the archive is genuinely
  // empty AND the user hasn't seen (or dismissed) the tour. We wait for
  // the library hook to finish its initial fetch before deciding —
  // surfacing the tour against a cached library that's still loading
  // would be misleading. The tour itself persists the seen flag on
  // close, so the auto-open path fires at most once.
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    if (isInitialLoad) return;
    if (!isEmpty) return;
    if (hasSeenTour()) return;
    setTourOpen(true);
  }, [isInitialLoad, isEmpty]);
  const library = useMemo(
    () => filterAdultGenreIfNeeded(adult_content_level, rawLibrary ?? []),
    [adult_content_level, rawLibrary],
  );

  // Series where every owned volume is flagged collector (and at least one is
  // owned). Discreet gold 限 seal on the poster tells the user "full collector
  // set". Computed once at the Dashboard level so each card stays cheap.
  // Tsundoku map is derived in the same pass — one per series counting
  // owned but unread volumes (owned && !read_at). Piggyback avoids a
  // second full scan of the volumes array.
  const { allCollectorSet, tsundokuByMal, upcomingByMal, nextUpcomingByMal } =
    useMemo(() => {
      const byMal = new Map();
      const tsundoku = new Map();
      // 来 · Upcoming-volume tally per series. A series counts as
      // "upcoming" the moment it has at least one announced tome
      // whose release_date is still in the future. Computed in the
      // same pass as collector / tsundoku to avoid a second sweep
      // over the volumes array.
      const upcoming = new Map();
      // 次 · Per-series record of the SOONEST upcoming volume
      // ({ vol_num, release_date_ms }). Surfaced on the dashboard
      // card when the user already owns every published volume —
      // the "you're caught up, here's what arrives next" moment.
      // Storing the timestamp as a number avoids re-parsing the
      // ISO string on every comparison while sweeping.
      const nextUpcoming = new Map();
      const now = Date.now();
      for (const v of allVolumes ?? []) {
        // Track upcoming irrespective of `owned` — an upcoming tome
        // is by definition unowned (server enforces). The flag we're
        // computing is "this series has something on the horizon".
        if (v.release_date) {
          const ts = new Date(v.release_date).getTime();
          if (!Number.isNaN(ts) && ts > now) {
            upcoming.set(v.mal_id, (upcoming.get(v.mal_id) ?? 0) + 1);
            // Keep only the soonest one per series.
            const cur = nextUpcoming.get(v.mal_id);
            if (!cur || ts < cur.release_date_ms) {
              nextUpcoming.set(v.mal_id, {
                vol_num: v.vol_num,
                release_date_ms: ts,
              });
            }
          }
        }
        if (!v.owned) continue;
        const entry = byMal.get(v.mal_id) ?? { any: false, anyNonCollector: false };
        entry.any = true;
        if (!v.collector) entry.anyNonCollector = true;
        byMal.set(v.mal_id, entry);
        if (!v.read_at) {
          tsundoku.set(v.mal_id, (tsundoku.get(v.mal_id) ?? 0) + 1);
        }
      }
      const set = new Set();
      for (const [mal, { any, anyNonCollector }] of byMal) {
        if (any && !anyNonCollector) set.add(mal);
      }
      return {
        allCollectorSet: set,
        tsundokuByMal: tsundoku,
        upcomingByMal: upcoming,
        nextUpcomingByMal: nextUpcoming,
      };
    }, [allVolumes]);

  const stats = useMemo(() => {
    const series = library.length;
    let owned = 0;
    let total = 0;
    let complete = 0;
    for (const m of library) {
      const o = m.volumes_owned ?? 0;
      const t = m.volumes ?? 0;
      owned += o;
      total += t;
      if (t > 0 && o >= t) complete += 1;
    }
    return { series, owned, total, complete };
  }, [library]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = library;
    if (q) {
      result = result.filter((m) => m.name?.toLowerCase().includes(q));
    }
    if (filter === "complete") {
      result = result.filter(
        (m) => (m.volumes ?? 0) > 0 && (m.volumes_owned ?? 0) >= m.volumes,
      );
    } else if (filter === "inprogress") {
      // Genuinely in flight: at least one owned volume, but not all of
      // them. Series with no published total (volumes === 0) also count
      // here as long as the user owns something — they're objectively
      // "being collected".
      result = result.filter((m) => {
        const o = m.volumes_owned ?? 0;
        const tot = m.volumes ?? 0;
        return o > 0 && (tot === 0 || o < tot);
      });
    } else if (filter === "wishlist") {
      // 願 · tracked, none owned yet. Requires a known total so we never
      // confuse a freshly-imported custom series (no published count) with
      // a deliberate wishlist intent.
      result = result.filter(
        (m) => (m.volumes_owned ?? 0) === 0 && (m.volumes ?? 0) > 0,
      );
    } else if (filter === "tsundoku") {
      // Tsundoku (積読) = series with ≥1 owned-but-unread volume.
      result = result.filter((m) => (tsundokuByMal.get(m.mal_id) ?? 0) > 0);
    } else if (filter === "upcoming") {
      // 来 · Series with ≥1 announced-but-not-yet-released tome —
      // the calendar's "this is on the horizon" axis surfaced as a
      // dashboard filter so the user can drill in from the library
      // grid without leaving the page.
      result = result.filter((m) => (upcomingByMal.get(m.mal_id) ?? 0) > 0);
    }
    // Tag intersection — AND logic. Each series must carry every selected
    // tag. Genres are trimmed at read time so "  Romance " matches "Romance".
    if (activeTags.size > 0) {
      result = result.filter((m) => {
        const owned = new Set(
          (m.genres ?? []).map((g) => (g ?? "").trim()).filter(Boolean),
        );
        for (const tag of activeTags) {
          if (!owned.has(tag)) return false;
        }
        return true;
      });
    }
    return result;
    // `tsundokuByMal` is a memoised Map; including it as a dep lets
    // the filter recompute when the tsundoku slice changes (a volume
    // flip toggles a row in/out of the "積" bucket).
  }, [library, filter, query, activeTags, tsundokuByMal, upcomingByMal]);

  // 段 · Pagination state — only `visibleCount` cards are mounted at a
  // given time. `sentinelRef` points at a sentinel element after the
  // grid; its intersection with the viewport extends `visibleCount`.
  // Seeded from the persisted view so a back-navigation lands on a
  // page that's already as tall as it was when we left — otherwise
  // the scroll-restoration target would land outside the (too-short)
  // initial 30-card document and clamp to the bottom.
  const [visibleCount, setVisibleCount] = useState(
    () => persisted?.visibleCount ?? LIBRARY_PAGE_SIZE,
  );
  const sentinelRef = useRef(null);

  // Reset pagination on any filter / search / tag change so the user
  // who flips from "Complete" to "All" doesn't keep an artificially
  // truncated view from the previous filter's bucket size. The
  // initial-mount tick is suppressed via `firstResetRef` so seeding
  // visibleCount from sessionStorage isn't immediately wiped by this
  // effect firing on its first run with the dependencies' initial
  // values.
  const firstResetRef = useRef(true);
  useEffect(() => {
    if (firstResetRef.current) {
      firstResetRef.current = false;
      return;
    }
    setVisibleCount(LIBRARY_PAGE_SIZE);
  }, [filter, query, activeTags]);

  // Persist the view state (filter / query / tags / pagination) so a
  // back-nav from MangaPage restores the exact same shelf. We avoid
  // a per-keystroke storage write for `query` by relying on React's
  // batching — within a single render, all four values are written
  // once when any of them flips.
  useEffect(() => {
    writePersistedDashboardState({
      query,
      filter,
      activeTags: Array.from(activeTags),
      visibleCount,
    });
  }, [query, filter, activeTags, visibleCount]);

  // Slice the result to the current page. `useMemo` avoids re-computing
  // the slice when nothing relevant changed (e.g. a sibling re-render).
  const visibleSlice = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );
  const hasMore = visibleCount < filtered.length;

  // IntersectionObserver — bumps `visibleCount` by another page when
  // the sentinel scrolls into view. `rootMargin: 200px` triggers the
  // load slightly before the sentinel hits the viewport so the next
  // batch is already painted by the time the user scrolls there. The
  // observer only mounts when there IS more to show, and tears down
  // when we've exhausted the filtered list.
  useEffect(() => {
    if (!hasMore) return undefined;
    const node = sentinelRef.current;
    if (!node) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisibleCount((prev) =>
              Math.min(prev + LIBRARY_PAGE_SIZE, filtered.length),
            );
          }
        }
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasMore, filtered.length]);

  return (
    <DefaultBackground>
      <WelcomeTour open={tourOpen} onClose={() => setTourOpen(false)} />
      <div className="mx-auto max-w-7xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
        {/* 季節 · Once-per-season banner. Self-renders nothing when
            the current season has already been greeted; sits above
            the masthead so it reads as a foreword to the page rather
            than another stat row. */}
        <SeasonGreeting />
        {/* Masthead */}
        <header className="mb-8 animate-fade-up">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.3em] text-washi-dim">
              {t("dashboard.archive")}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>

          {/* 帯 · Stat ribbon — compressed from the previous 4-card
              grid (≈140 px tall) to a single line read.
              Why the change:
                The dashboard's centre-of-gravity is the series grid.
                Four full stat-cards stacked above the title, then a
                gap-suggestion carousel, then a search bar, then a
                filter rail, pushed the grid below the fold on a 1280
                viewport — meaning users had to scroll to see what
                they came for. The ribbon keeps the four numbers
                accessible at a glance but reclaims ~110 px of
                vertical real-estate; the digits remain in
                tabular-nums so updates don't jitter the layout.
              The colour grammar matches the previous card treatment:
              washi for raw counts, gold for the achievement (complete
              series), hanko for the rate (progression %). */}
          <div
            className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.18em] text-washi-dim sm:gap-x-6"
            role="group"
            aria-label={t("dashboard.archive")}
          >
            <RibbonStat
              label={t("dashboard.series")}
              value={stats.series}
              loading={isInitialLoad}
            />
            <span aria-hidden="true" className="text-washi-dim/40">·</span>
            <RibbonStat
              label={t("dashboard.volumes")}
              value={`${stats.owned}/${stats.total || "?"}`}
              loading={isInitialLoad}
              width="6ch"
            />
            <span aria-hidden="true" className="text-washi-dim/40">·</span>
            <RibbonStat
              label={t("dashboard.complete")}
              value={stats.complete}
              accent="gold"
              loading={isInitialLoad}
            />
            <span aria-hidden="true" className="text-washi-dim/40">·</span>
            <RibbonStat
              label={t("dashboard.progress")}
              value={
                stats.total
                  ? `${Math.round((stats.owned / stats.total) * 100)}%`
                  : "—"
              }
              accent="hanko"
              loading={isInitialLoad}
              width="5ch"
            />
          </div>

          <h1 className="mt-3 font-display text-4xl font-light italic leading-none tracking-tight text-washi md:text-6xl">
            {t("dashboard.yourLibrary")}{" "}
            <span className="text-hanko-gradient font-semibold not-italic">
              {t("dashboard.library")}
            </span>
          </h1>
        </header>

        {/* Controls */}
        <section className="mb-8 space-y-4" aria-label="Controls">
          <MangaSearchBar
            query={query}
            setQuery={setQuery}
            searchManga={() => {}}
            loading={false}
            placeholder={t("dashboard.searchPlaceholder")}
            clearResults={() => setQuery("")}
            hasResults={Boolean(query)}
            clearText={t("dashboard.clearFilter")}
            additionalButtons={
              !isInitialLoad && !isEmpty ? (
                <FilterButton
                  library={library}
                  activeTags={activeTags}
                  onToggle={toggleTag}
                  onClear={clearTags}
                  resultsCount={filtered.length}
                />
              ) : null
            }
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Filter rail — kanji-first navigation.
                Each filter carries a Japanese glyph that's always visible,
                with the romaji label revealed from `sm:` upwards. On mobile
                the pill collapses to a single character framed by a
                ≥44 px touch target — no overflow, no truncation, and the
                glyph stays in the same typographic family as the rest of
                the project (限 collector / 積 tsundoku / 完 complete).

                  全 zen      → all
                  進 shin     → in progress
                  願 negai    → wishlist (wanted, not yet acquired)
                  完 kan      → complete (finished collection)
                  積 tsumu    → tsundoku (owned but unread)

                Selected colour follows the state grammar already used by
                the Manga card badges. */}
            <div
              className="inline-flex rounded-full border border-border bg-ink-1/60 p-1 backdrop-blur"
              role="tablist"
              aria-label={t("dashboard.filterTablistLabel")}
            >
              {[
                { id: "all", glyph: "全", label: t("dashboard.tabAll") },
                { id: "inprogress", glyph: "進", label: t("dashboard.tabOngoing") },
                {
                  id: "wishlist",
                  glyph: "願",
                  label: t("dashboard.tabWishlist"),
                  tooltip: `${t("dashboard.tabWishlist")} · ${t("dashboard.tabHintWishlist")}`,
                },
                { id: "complete", glyph: "完", label: t("dashboard.tabComplete") },
                {
                  id: "tsundoku",
                  glyph: "積",
                  label: t("dashboard.tabTsundoku"),
                  tooltip: `${t("dashboard.tabTsundoku")} · ${t("dashboard.tabHintTsundoku")}`,
                },
                {
                  id: "upcoming",
                  glyph: "来",
                  label: t("dashboard.tabUpcoming"),
                  tooltip: `${t("dashboard.tabUpcoming")} · ${t("dashboard.tabHintUpcoming")}`,
                },
              ].map((tab) => {
                const active = filter === tab.id;
                const activeBg =
                  tab.id === "wishlist"
                    ? "bg-sakura text-ink-0 shadow-md"
                    : tab.id === "tsundoku"
                      ? "bg-moegi text-ink-0 shadow-md"
                      : tab.id === "upcoming"
                        ? "bg-moegi text-ink-0 shadow-md"
                        : "bg-hanko text-washi shadow-md";
                return (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={active}
                    aria-label={tab.label}
                    title={tab.tooltip ?? tab.label}
                    onClick={() => setFilter(tab.id)}
                    className={`group/tab inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3.5 text-xs font-semibold uppercase tracking-wider transition sm:min-h-0 sm:py-1.5 ${
                      active ? activeBg : "text-washi-muted hover:text-washi"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`font-jp text-base font-bold leading-none transition-transform sm:text-sm ${
                        active ? "scale-110" : "opacity-80 group-hover/tab:opacity-100"
                      }`}
                    >
                      {tab.glyph}
                    </span>
                    {/* Label appears from sm: up. On mobile, the glyph + the
                        aria-label / native tooltip carry the meaning, and the
                        whole row stops fighting for horizontal space. */}
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => navigate("/addmanga")}
              className="group hidden md:inline-flex items-center gap-2 rounded-full bg-hanko px-5 py-2.5 text-sm font-semibold text-washi shadow-lg transition-all hover:scale-[1.03] hover:glow-red active:scale-95"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4 transition-transform group-hover:rotate-90"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              {t("dashboard.addManga")}
            </button>
          </div>

          {/* Editorial gloss — only rendered for filters whose name carries
              cultural baggage (the Japanese terms 願 / 積読). Sits in a
              `min-h` reserve so the grid below doesn't jump when switching
              between glossed and unglossed filters. The `key={filter}`
              re-mounts the line on every change, replaying the fade-up
              animation as a subtle "you just changed lens" cue.
              `aria-live="polite"` lets screen readers hear the definition
              after a filter switch without interrupting the user. */}
          <div className="min-h-[1.5rem] px-1" aria-live="polite">
            {(() => {
              if (filter !== "wishlist" && filter !== "tsundoku") return null;
              const isWishlist = filter === "wishlist";
              const romaji = isWishlist ? "願 negai" : "積読 tsundoku";
              const text = isWishlist
                ? t("dashboard.tabHintWishlist")
                : t("dashboard.tabHintTsundoku");
              const tone = isWishlist ? "text-sakura" : "text-moegi";
              return (
                <p
                  key={filter}
                  className="animate-fade-up flex flex-wrap items-baseline gap-x-2 gap-y-0.5 leading-snug"
                  style={{ animationDuration: "0.4s" }}
                >
                  <span
                    className={`font-jp text-[11px] font-semibold tracking-[0.15em] ${tone}`}
                  >
                    {romaji}
                  </span>
                  <span className="font-display text-[11px] italic text-washi-muted">
                    {text}
                  </span>
                </p>
              );
            })()}
          </div>
        </section>

        {/* Active tag chips — discreet "Filtré par: [shōnen ×] [drame ×]"
            row. Only renders when at least one tag is active, so zero
            visual weight in the idle state. */}
        <ActiveChips
          activeTags={activeTags}
          onToggle={toggleTag}
          onClear={clearTags}
        />

        {/* Grid */}
        <section>
          {isInitialLoad ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {[...Array(12)].map((_, i) => (
                <Skeleton.Card key={i} />
              ))}
            </div>
          ) : isEmpty || filtered.length === 0 ? (
            <EmptyState
              hasQuery={Boolean(query)}
              hasActiveTags={activeTags.size > 0}
              onAdd={() => navigate("/addmanga")}
              onClearTags={clearTags}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {visibleSlice.map((manga, i) => (
                  <div
                    // Use the Dexie row `id` as a stable, unique key.
                    // `mal_id` collides when multiple custom series with
                    // `mal_id = null` coexist (a legitimate state before
                    // a server-side negative id is minted), triggering
                    // React key-collision warnings and mis-mounted DOM
                    // between sibling Manga cards. Falling back through
                    // `mal_id` → `index` preserves keying for legacy
                    // rows that may lack a Dexie primary key in hand.
                    key={manga.id ?? manga.mal_id ?? `idx-${i}`}
                    // Cap the staggered fade-up delay at 500 ms so a
                    // 30th card doesn't take 1.2 s before appearing —
                    // pagination keeps `i` bounded already, but the
                    // cap is defensive against future page-size bumps.
                    style={{ animationDelay: `${Math.min(i * 40, 500)}ms` }}
                    className="animate-fade-up"
                  >
                    <Manga
                      manga={manga}
                      adult_content_level={adult_content_level}
                      allCollector={allCollectorSet.has(manga.mal_id)}
                      tsundokuCount={tsundokuByMal.get(manga.mal_id) ?? 0}
                      nextUpcoming={nextUpcomingByMal.get(manga.mal_id)}
                    />
                  </div>
                ))}
              </div>

              {/* 段 · Sentinel — IntersectionObserver target. The
                  observer's rootMargin pulls the trigger ~200 px before
                  the sentinel scrolls into view so the next page lands
                  before the user sees the gap. The visible kanji 段
                  (dan, "step / level") is intentionally dim so it reads
                  as a quiet step-marker, not a CTA — the load is
                  automatic. Hidden once the full list is mounted. */}
              {hasMore && (
                <div
                  ref={sentinelRef}
                  className="mt-8 flex flex-col items-center gap-2 text-washi-dim"
                  aria-hidden="true"
                >
                  <span className="font-jp text-2xl font-bold leading-none opacity-30">
                    段
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.3em] opacity-50">
                    {visibleCount} / {filtered.length}
                  </span>
                </div>
              )}
            </>
          )}
        </section>

        {/* R1 — "Complete your collection" suggestions.
            Repositioned below the grid (was: between the masthead
            and the search/filter rail). The carousel is a discovery
            module, not a primary surface — putting it after the user
            has scanned their actual library makes it a recommendation
            ("here's what you could close out next") rather than a
            prologue ("here's what we suggest before you even see your
            shelves"). The underlying component already self-hides
            when there's nothing to suggest, so empty libraries pay
            zero layout cost. */}
        {!isInitialLoad && !isEmpty && <GapSuggestions />}
      </div>
    </DefaultBackground>
  );
}

/**
 * 帯 · One stat in the masthead ribbon.
 *
 * Renders as label-then-value spans grouped in an `inline-flex` —
 * keeping `whitespace-nowrap` so a stat never wraps mid-pair (the
 * `12 series` cluster always stays glued together; only the gaps
 * between pairs are wrap points).
 *
 * Accent grammar matches the previous StatChip card it replaces:
 * washi for raw counts, gold for the achievement total
 * (complete series), hanko for the rate (progression %).
 *
 * Loading state borrows `Skeleton.Stat`'s `min-h: 1em` so the
 * baseline doesn't jitter when the placeholder swaps in for the
 * real value.
 */
function RibbonStat({ label, value, accent, loading, width }) {
  const accentClass =
    accent === "hanko"
      ? "text-hanko-bright"
      : accent === "gold"
        ? "text-gold"
        : accent === "moegi"
          ? "text-moegi"
          : "text-washi";
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-washi-dim/80">{label}</span>
      <span
        className={`font-display text-base font-semibold not-italic tabular-nums normal-case tracking-normal ${accentClass}`}
      >
        {loading ? <Skeleton.Stat width={width} /> : value}
      </span>
    </span>
  );
}

function EmptyState({ hasQuery, hasActiveTags, onAdd, onClearTags }) {
  const t = useT();
  // Three flavours: filtered-by-tags (loosen the tags), searched (try different
  // query), or truly empty archive (add first series).
  const title = hasActiveTags
    ? t("dashboard.noTagMatchTitle")
    : hasQuery
      ? t("dashboard.noMatchTitle")
      : t("dashboard.emptyTitle");
  const body = hasActiveTags
    ? t("dashboard.noTagMatchBody")
    : hasQuery
      ? t("dashboard.noMatchBody")
      : t("dashboard.emptyBody");
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-ink-1/30 px-6 py-16 text-center animate-fade-up">
      <div
        className="hanko-seal mb-4 grid h-16 w-16 place-items-center rounded-md font-display text-xl"
        title={t("badges.empty")}
      >
        空
      </div>
      <h2 className="font-display text-2xl italic text-washi">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-washi-muted">{body}</p>
      {hasActiveTags ? (
        <button
          onClick={onClearTags}
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-hanko/40 bg-hanko/10 px-5 py-2.5 text-sm font-semibold text-washi transition hover:bg-hanko/20 hover:border-hanko"
        >
          <span aria-hidden="true" className="font-jp text-base leading-none">
            解
          </span>
          {t("dashboard.clearTags")}
        </button>
      ) : !hasQuery ? (
        <button
          onClick={onAdd}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-hanko px-5 py-2.5 text-sm font-semibold text-washi shadow-lg transition-transform hover:scale-[1.03] active:scale-95"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t("dashboard.addFirst")}
        </button>
      ) : null}
    </div>
  );
}
