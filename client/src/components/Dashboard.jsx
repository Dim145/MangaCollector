import { useState, useEffect } from "react";
import { getUserLibrary, addToUserLibrary } from "../utils/user";
import { useNavigate } from "react-router-dom";
import Manga from "./Manga";

export default function Dashboard() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function loadLibrary() {
      try {
        const userLibrary = await getUserLibrary();
        setLibrary(userLibrary);
      } catch (err) {
        console.error(err);
      }
    }

    loadLibrary();
  }, []);

  const searchManga = async () => {
    if (!query.trim()) return;
    try {
      setLoading(true);
      const res = await fetch(
        `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(query)}&limit=10`,
      );
      const data = await res.json();
      setResults(data.data || []);
      console.log(data.data);
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
        image_url_jpg: manga.images.jpg.image_url,
      };

      if (library.some((m) => m.mal_id === mangaData.mal_id)) {
        console.log("Already in library");
        return;
      }

      await addToUserLibrary(mangaData);
      setLibrary((prev) => [...prev, mangaData]); // 👈 update UI immediately
    } catch (error) {
      console.error(error);
    } finally {
      setIsAdding(false);
    }
  };

  const clearResults = () => {
    setResults([]);
    setQuery("");
  };

  return (
    <div className="relative min-h-screen text-white overflow-hidden">
      {/* BACKDROP LAYERS */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black via-gray-900 to-black" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_30%,rgba(255,255,255,0.08),transparent_60%)]" />
      <div className="absolute inset-0 -z-10 backdrop-blur-3xl" />

      <div className="p-8 max-w-5xl mx-auto space-y-12">
        {/* Header */}
        <h1 className="text-3xl font-extrabold text-center bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent tracking-wide">
          Manga Dashboard
        </h1>

        {/* Search Section */}
        <div className="w-full">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <input
              type="text"
              placeholder="Search manga..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchManga()}
              className="flex-1 px-4 py-3 rounded-2xl bg-gray-800/80 text-white border border-gray-700 focus:outline-none focus:ring-2 focus:ring-white/70 backdrop-blur-sm"
            />
            <div className="flex gap-2 sm:gap-3">
              <button
                onClick={searchManga}
                className="flex-1 sm:flex-none px-5 py-3 rounded-2xl font-semibold bg-gradient-to-r from-gray-700 to-gray-600 hover:scale-105 transform transition"
                disabled={loading}
              >
                {loading ? "Searching..." : "Search"}
              </button>
              {results.length > 0 && (
                <button
                  onClick={clearResults}
                  className="flex-1 sm:flex-none px-5 py-3 rounded-2xl font-semibold bg-gradient-to-r from-gray-600 to-gray-700 hover:scale-105 transform transition"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Dropdown Results */}
          {results.length > 0 && (
            <div className="mt-4 w-full max-h-96 overflow-y-auto bg-gray-900/90 border border-gray-700 rounded-2xl shadow-xl backdrop-blur-lg animate-fadeIn">
              {results.map((manga) => (
                <div
                  key={manga.mal_id}
                  className="flex items-center gap-3 p-3 hover:bg-gray-800/70 transition cursor-pointer"
                >
                  <img
                    src={manga.images.jpg.image_url}
                    alt={manga.title}
                    className="h-14 w-auto rounded-md shadow"
                  />
                  <div className="flex-1">
                    <p className="font-semibold">{manga.title}</p>
                    <p className="text-xs text-gray-400">
                      Volumes: {manga.volumes ?? "?"}
                    </p>
                  </div>
                  <button
                    onClick={() => addToLibrary(manga)}
                    className="px-3 py-1 bg-gradient-to-r from-green-400 to-green-600 hover:scale-105 transform transition rounded-lg text-black text-xs font-semibold"
                    disabled={isAdding}
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Storage Section */}
        <div>
          <div>
            <h2 className="text-2xl font-bold mb-2 text-white">My Library</h2>
            <p className="text-2xs mb-4 text-gray-300/75">
              Click on any manga to enter more information
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
            {library.map((manga) => (
              <Manga key={manga.mal_id} manga={manga} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
