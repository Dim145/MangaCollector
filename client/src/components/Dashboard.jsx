import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Manga from "./Manga";
import DefaultBackground from "./DefaultBackground";
import MangaSearchBar from "./MangaSearchBar";
import GapSuggestions from "./GapSuggestions.jsx";
import { FilterButton, ActiveChips } from "./TagFilter.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import WelcomeTour from "./WelcomeTour.jsx";
import { hasSeenTour } from "@/lib/tour.js";
import SettingsContext from "@/SettingsContext.js";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";
import { filterAdultGenreIfNeeded } from "@/utils/library.js";
import { useT } from "@/i18n/index.jsx";

export default function Dashboard() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
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
  const [activeTags, setActiveTags] = useState(() => new Set());
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
  const { allCollectorSet, tsundokuByMal } = useMemo(() => {
    const byMal = new Map();
    const tsundoku = new Map();
    for (const v of allVolumes ?? []) {
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
    return { allCollectorSet: set, tsundokuByMal: tsundoku };
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
  }, [library, filter, query, activeTags, tsundokuByMal]);

  return (
    <DefaultBackground>
      <WelcomeTour open={tourOpen} onClose={() => setTourOpen(false)} />
      <div className="mx-auto max-w-7xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
        {/* Masthead */}
        <header className="mb-8 animate-fade-up">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.3em] text-washi-dim">
              {t("dashboard.archive")}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>
          <h1 className="mt-2 font-display text-4xl font-light italic leading-none tracking-tight text-washi md:text-6xl">
            {t("dashboard.yourLibrary")}{" "}
            <span className="text-hanko-gradient font-semibold not-italic">
              {t("dashboard.library")}
            </span>
          </h1>

          {/* Stat chips */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* Stat-card colour grammar (locked across Dashboard + Profile):
                  · count   → washi    (raw counts: series, volumes-owned/total)
                  · achievement → gold (lifetime totals: complete series, € invested)
                  · rate    → hanko    (current rate / progression: % done)
                The same metric uses the same colour on every page. */}
            <StatChip
              label={t("dashboard.series")}
              value={stats.series}
              loading={isInitialLoad}
            />
            <StatChip
              label={t("dashboard.volumes")}
              value={`${stats.owned}/${stats.total || "?"}`}
              loading={isInitialLoad}
              width="6ch"
            />
            <StatChip
              label={t("dashboard.complete")}
              value={stats.complete}
              accent="gold"
              loading={isInitialLoad}
            />
            <StatChip
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
        </header>

        {/* R1 — "Complete your collection" suggestions */}
        {!isInitialLoad && !isEmpty && <GapSuggestions />}

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
              ].map((tab) => {
                const active = filter === tab.id;
                const activeBg =
                  tab.id === "wishlist"
                    ? "bg-sakura text-ink-0 shadow-md"
                    : tab.id === "tsundoku"
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {filtered.map((manga, i) => (
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
                  style={{ animationDelay: `${Math.min(i * 40, 500)}ms` }}
                  className="animate-fade-up"
                >
                  <Manga
                    manga={manga}
                    adult_content_level={adult_content_level}
                    allCollector={allCollectorSet.has(manga.mal_id)}
                    tsundokuCount={tsundokuByMal.get(manga.mal_id) ?? 0}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </DefaultBackground>
  );
}

function StatChip({ label, value, accent, loading, width }) {
  const accentClass =
    accent === "hanko"
      ? "text-hanko-bright"
      : accent === "gold"
        ? "text-gold"
        : accent === "moegi"
          ? "text-moegi"
          : "text-washi";
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-ink-1/50 p-4 backdrop-blur transition hover:border-hanko/30">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
        {label}
      </p>
      <p
        className={`mt-2 font-display text-2xl font-semibold tabular-nums md:text-3xl ${accentClass}`}
      >
        {loading ? <Skeleton.Stat width={width} /> : value}
      </p>
      <div className="pointer-events-none absolute -bottom-6 -right-6 h-16 w-16 rounded-full bg-hanko/10 blur-2xl opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
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
