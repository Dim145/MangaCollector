import { useContext, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Manga from "./Manga";
import DefaultBackground from "./DefaultBackground";
import MangaSearchBar from "./MangaSearchBar";
import SettingsContext from "@/SettingsContext.js";
import { useLibrary } from "@/hooks/useLibrary.js";
import { filterAdultGenreIfNeeded } from "@/utils/library.js";

export default function Dashboard() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"); // all | complete | inprogress
  const { adult_content_level } = useContext(SettingsContext);
  const navigate = useNavigate();

  const { data: rawLibrary, isLoading } = useLibrary();
  const library = useMemo(
    () => filterAdultGenreIfNeeded(adult_content_level, rawLibrary ?? []),
    [adult_content_level, rawLibrary]
  );

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
        (m) => (m.volumes ?? 0) > 0 && (m.volumes_owned ?? 0) >= m.volumes
      );
    } else if (filter === "inprogress") {
      result = result.filter(
        (m) => (m.volumes ?? 0) === 0 || (m.volumes_owned ?? 0) < m.volumes
      );
    }
    return result;
  }, [library, filter, query]);

  return (
    <DefaultBackground>
      <div className="mx-auto max-w-7xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
        {/* Masthead */}
        <header className="mb-8 animate-fade-up">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.3em] text-washi-dim">
              ARCHIVE · 本棚
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>
          <h1 className="mt-2 font-display text-4xl font-light italic leading-none tracking-tight text-washi md:text-6xl">
            Your <span className="text-hanko-gradient font-semibold not-italic">Library</span>
          </h1>

          {/* Stat chips */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatChip label="Series" value={stats.series} />
            <StatChip label="Volumes" value={`${stats.owned}/${stats.total || "?"}`} />
            <StatChip label="Complete" value={stats.complete} accent="gold" />
            <StatChip
              label="Progress"
              value={
                stats.total
                  ? `${Math.round((stats.owned / stats.total) * 100)}%`
                  : "—"
              }
              accent="hanko"
            />
          </div>
        </header>

        {/* Controls */}
        <section className="mb-8 space-y-4" aria-label="Controls">
          <MangaSearchBar
            query={query}
            setQuery={setQuery}
            searchManga={() => {}}
            loading={false}
            placeholder="Search your library…"
            clearResults={() => setQuery("")}
            hasResults={Boolean(query)}
            clearText="Clear"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              className="inline-flex rounded-full border border-border bg-ink-1/60 p-1 backdrop-blur"
              role="tablist"
              aria-label="Filter"
            >
              {[
                { id: "all", label: "All" },
                { id: "inprogress", label: "Ongoing" },
                { id: "complete", label: "Complete" },
              ].map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={filter === t.id}
                  onClick={() => setFilter(t.id)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
                    filter === t.id
                      ? "bg-hanko text-washi shadow-md"
                      : "text-washi-muted hover:text-washi"
                  }`}
                >
                  {t.label}
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
              Add manga
            </button>
          </div>
        </section>

        {/* Grid */}
        <section>
          {isLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {[...Array(12)].map((_, i) => (
                <div
                  key={i}
                  className="aspect-[2/3] w-full animate-shimmer rounded-lg"
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState hasQuery={Boolean(query)} onAdd={() => navigate("/addmanga")} />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {filtered.map((manga, i) => (
                <div
                  key={manga.mal_id}
                  style={{ animationDelay: `${Math.min(i * 40, 500)}ms` }}
                  className="animate-fade-up"
                >
                  <Manga manga={manga} adult_content_level={adult_content_level} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </DefaultBackground>
  );
}

function StatChip({ label, value, accent }) {
  const accentClass =
    accent === "hanko"
      ? "text-hanko-bright"
      : accent === "gold"
        ? "text-gold"
        : "text-washi";
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-ink-1/50 p-4 backdrop-blur transition hover:border-hanko/30">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
        {label}
      </p>
      <p className={`mt-2 font-display text-2xl font-semibold tabular-nums md:text-3xl ${accentClass}`}>
        {value}
      </p>
      <div className="pointer-events-none absolute -bottom-6 -right-6 h-16 w-16 rounded-full bg-hanko/10 blur-2xl opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}

function EmptyState({ hasQuery, onAdd }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-ink-1/30 px-6 py-16 text-center animate-fade-up">
      <div className="hanko-seal mb-4 grid h-16 w-16 place-items-center rounded-md font-display text-xl">
        空
      </div>
      <h2 className="font-display text-2xl italic text-washi">
        {hasQuery ? "No match" : "The shelf is empty"}
      </h2>
      <p className="mt-2 max-w-md text-sm text-washi-muted">
        {hasQuery
          ? "We couldn't find a title with that name in your archive."
          : "Start curating your collection — search a title, add a volume, and watch your archive grow."}
      </p>
      {!hasQuery && (
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
          Add your first series
        </button>
      )}
    </div>
  );
}
