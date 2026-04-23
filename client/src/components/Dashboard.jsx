import { useCallback, useContext, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Manga from "./Manga";
import DefaultBackground from "./DefaultBackground";
import MangaSearchBar from "./MangaSearchBar";
import GapSuggestions from "./GapSuggestions.jsx";
import { FilterButton, ActiveChips } from "./TagFilter.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import SettingsContext from "@/SettingsContext.js";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";
import { filterAdultGenreIfNeeded } from "@/utils/library.js";
import { useT } from "@/i18n/index.jsx";

export default function Dashboard() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"); // all | complete | inprogress
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
  const library = useMemo(
    () => filterAdultGenreIfNeeded(adult_content_level, rawLibrary ?? []),
    [adult_content_level, rawLibrary],
  );

  // Series where every owned volume is flagged collector (and at least one is
  // owned). Discreet gold 限 seal on the poster tells the user "full collector
  // set". Computed once at the Dashboard level so each card stays cheap.
  const allCollectorSet = useMemo(() => {
    const byMal = new Map();
    for (const v of allVolumes ?? []) {
      if (!v.owned) continue;
      const entry = byMal.get(v.mal_id) ?? { any: false, anyNonCollector: false };
      entry.any = true;
      if (!v.collector) entry.anyNonCollector = true;
      byMal.set(v.mal_id, entry);
    }
    const set = new Set();
    for (const [mal, { any, anyNonCollector }] of byMal) {
      if (any && !anyNonCollector) set.add(mal);
    }
    return set;
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
      result = result.filter(
        (m) => (m.volumes ?? 0) === 0 || (m.volumes_owned ?? 0) < m.volumes,
      );
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
  }, [library, filter, query, activeTags]);

  return (
    <DefaultBackground>
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
              accent="moegi"
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
            <div
              className="inline-flex rounded-full border border-border bg-ink-1/60 p-1 backdrop-blur"
              role="tablist"
              aria-label={t("common.search")}
            >
              {[
                { id: "all", label: t("dashboard.tabAll") },
                { id: "inprogress", label: t("dashboard.tabOngoing") },
                { id: "complete", label: t("dashboard.tabComplete") },
              ].map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={filter === tab.id}
                  onClick={() => setFilter(tab.id)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
                    filter === tab.id
                      ? "bg-hanko text-washi shadow-md"
                      : "text-washi-muted hover:text-washi"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
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
                  key={manga.mal_id}
                  style={{ animationDelay: `${Math.min(i * 40, 500)}ms` }}
                  className="animate-fade-up"
                >
                  <Manga
                    manga={manga}
                    adult_content_level={adult_content_level}
                    allCollector={allCollectorSet.has(manga.mal_id)}
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
