import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import MangaSearchBar from "@/components/MangaSearchBar.jsx";
import MangaSearchResults from "@/components/MangaSearchResults.jsx";
import SettingsContext from "@/SettingsContext.js";
import {
  addCustomEntryToUserLibrary,
  addToUserLibrary,
  getUserLibrary,
} from "@/utils/user.js";

export default function AddPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [library, setLibrary] = useState([]);
  const [searched, setSearched] = useState(false);

  const [customEntry, setCustomEntry] = useState(false);
  const [customEntryTitle, setCustomEntryTitle] = useState("");
  const [customEntryGenres, setCustomEntryGenres] = useState("");
  const [customEntryVolumes, setCustomEntryVolumes] = useState(0);

  const { adult_content_level } = useContext(SettingsContext);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        setLibrary(await getUserLibrary());
      } catch (err) {
        console.error(err);
      }
    })();
  }, []);

  const searchManga = async () => {
    if (!query.trim()) return;
    try {
      setLoading(true);
      setSearched(true);
      const res = await fetch(
        `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(query)}&limit=10`
      );
      const data = await res.json();
      setResults(data.data || []);
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setLoading(false);
    }
  };

  const addToLibrary = async (manga) => {
    try {
      setIsAdding(true);
      const mangaData = {
        name: manga.title,
        mal_id: manga.mal_id,
        volumes: manga.volumes == null ? 0 : manga.volumes,
        volumes_owned: 0,
        image_url_jpg:
          manga.images.jpg.large_image_url || manga.images.jpg.image_url,
        genres: (manga.genres || [])
          .concat(manga.explicit_genres || [])
          .concat(manga.demographics || [])
          .filter((g) => g.type === "manga")
          .map((g) => g.name),
      };

      if (library.some((m) => m.mal_id === mangaData.mal_id)) {
        return;
      }

      await addToUserLibrary(mangaData);
      setLibrary((prev) => [...prev, mangaData]);
    } catch (error) {
      console.error(error);
    } finally {
      setIsAdding(false);
    }
  };

  const clearResults = () => {
    setResults([]);
    setQuery("");
    setSearched(false);
  };

  const handleSaveCustomEntry = async () => {
    if (!customEntryTitle.trim()) return;

    const mangaData = {
      name: customEntryTitle,
      mal_id: null,
      volumes: customEntryVolumes,
      volumes_owned: 0,
      image_url_jpg: null,
      genres: customEntryGenres
        .split(",")
        .map((g) => g.trim())
        .filter((g) => g.length > 0),
    };

    const res = await addCustomEntryToUserLibrary(mangaData);

    if (res.success) {
      navigate("/mangapage", {
        state: { manga: res.newEntry, adult_content_level },
      });
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
      {/* Header */}
      <header className="mb-8 animate-fade-up">
        <button
          onClick={() => navigate("/dashboard")}
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs uppercase tracking-[0.3em] text-washi-dim">
            ADD · 追加
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
        </div>
        <h1 className="mt-2 font-display text-4xl font-light italic leading-none tracking-tight text-washi md:text-5xl">
          Add to your <span className="text-hanko-gradient font-semibold not-italic">archive</span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-washi-muted">
          Search MyAnimeList to import a series with full metadata, or create a
          custom entry for niche titles and physical editions.
        </p>
      </header>

      {/* Tabs */}
      <div className="mb-6 inline-flex rounded-full border border-border bg-ink-1/60 p-1 backdrop-blur">
        <button
          onClick={() => setCustomEntry(false)}
          className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
            !customEntry
              ? "bg-hanko text-washi shadow-md"
              : "text-washi-muted hover:text-washi"
          }`}
        >
          MAL Search
        </button>
        <button
          onClick={() => setCustomEntry(true)}
          className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
            customEntry
              ? "bg-hanko text-washi shadow-md"
              : "text-washi-muted hover:text-washi"
          }`}
        >
          Custom Entry
        </button>
      </div>

      {customEntry ? (
        <section className="animate-fade-up">
          <div className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur md:p-8">
            <p className="mb-6 rounded-lg border border-gold/20 bg-gold/5 p-3 text-xs text-washi-muted">
              <span className="font-semibold text-gold">Note:</span> Custom
              entries work great for titles not listed on MyAnimeList, doujinshi,
              or physical-only releases.
            </p>

            <div className="space-y-5">
              <div>
                <label
                  htmlFor="title"
                  className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim"
                >
                  Title
                </label>
                <input
                  id="title"
                  type="text"
                  value={customEntryTitle}
                  onChange={(e) => setCustomEntryTitle(e.target.value)}
                  placeholder="e.g. Underground Illustrations"
                  className="w-full rounded-lg border border-border bg-ink-0/60 px-4 py-3 text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
                />
              </div>

              <div>
                <label
                  htmlFor="genres"
                  className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim"
                >
                  Genres
                </label>
                <input
                  id="genres"
                  type="text"
                  value={customEntryGenres}
                  onChange={(e) => setCustomEntryGenres(e.target.value)}
                  placeholder="Comma-separated, e.g. Action, Fantasy, Seinen"
                  className="w-full rounded-lg border border-border bg-ink-0/60 px-4 py-3 text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
                />
              </div>

              <div>
                <label
                  htmlFor="volumes"
                  className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim"
                >
                  Number of volumes
                </label>
                <input
                  id="volumes"
                  type="number"
                  value={customEntryVolumes}
                  onChange={(e) => setCustomEntryVolumes(Number(e.target.value))}
                  min={0}
                  placeholder="0"
                  className="w-full rounded-lg border border-border bg-ink-0/60 px-4 py-3 text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
                />
              </div>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => {
                  setCustomEntry(false);
                  setCustomEntryTitle("");
                  setCustomEntryGenres("");
                  setCustomEntryVolumes(0);
                }}
                className="rounded-full border border-border bg-transparent px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCustomEntry}
                disabled={!customEntryTitle.trim()}
                className="rounded-full bg-hanko px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-washi shadow-lg transition hover:bg-hanko-bright active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create entry
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="space-y-6 animate-fade-up">
          <MangaSearchBar
            query={query}
            setQuery={setQuery}
            searchManga={searchManga}
            clearResults={clearResults}
            loading={loading}
            hasResults={results.length > 0}
            placeholder="Search MyAnimeList…"
          />

          {loading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 rounded-xl border border-border p-3"
                >
                  <div className="h-24 w-16 animate-shimmer rounded-md" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 animate-shimmer rounded" />
                    <div className="h-3 w-1/2 animate-shimmer rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : results.length > 0 ? (
            <MangaSearchResults
              results={results}
              addToLibrary={addToLibrary}
              isAdding={isAdding}
              isInLibrary={(mal_id) => library.some((m) => m.mal_id === mal_id)}
            />
          ) : searched ? (
            <div className="rounded-2xl border border-dashed border-border bg-ink-1/30 p-8 text-center">
              <p className="font-display text-lg italic text-washi-muted">
                No results for "{query}"
              </p>
              <p className="mt-2 text-xs text-washi-dim">
                Try another keyword, or switch to "Custom Entry" above.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-ink-1/30 p-8 text-center">
              <div className="hanko-seal mx-auto mb-3 grid h-12 w-12 place-items-center rounded-md font-display text-sm">
                捜
              </div>
              <p className="font-display text-lg italic text-washi">
                Begin with a title.
              </p>
              <p className="mt-1 text-xs text-washi-muted">
                Every great archive starts with a single volume.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
