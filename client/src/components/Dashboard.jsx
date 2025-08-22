import { useState, useEffect } from "react";
import { getUserLibrary, addToUserLibrary } from "../utils/user";

export default function Dashboard() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [library, setLibrary] = useState([]);

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
      const res = await fetch(
        `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(query)}&limit=10`,
      );
      const data = await res.json();
      setResults(data.data || []);
      console.log(data.data);
    } catch (err) {
      console.error("Search error:", err);
    }
  };

  const addToLibrary = async (manga) => {
    // ADD SOMETHING TO PREVENT DUPES (check locally if the loaded ones contain it)
    const mangaData = {
      name: manga.title,
      mal_id: manga.mal_id,
      volumes: manga.volumes == null ? 0 : manga.volumes,
      volumes_owned: 0,
      image_url_jpg: manga.images.jpg.image_url,
    };

    try {
      await addToUserLibrary(mangaData);
      setLibrary((prev) => [...prev, mangaData]); // 👈 update UI immediately
    } catch (error) {
      console.error(error);
    }
  };

  const clearResults = () => {
    setResults([]);
    setQuery("");
  };

  return (
    <div className="bg-gradient-to-b from-black via-gray-900 to-black min-h-screen text-white p-8">
      <div className="max-w-5xl mx-auto space-y-12">
        {/* Header */}
        <h1 className="text-3xl font-extrabold text-center bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent tracking-wide">
          Manga Dashboard
        </h1>

        {/* Search Section */}
        <div className="w-full">
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search manga..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchManga()}
              className="w-full px-4 py-3 rounded-2xl bg-gray-800/80 text-white border border-gray-700 focus:outline-none focus:ring-2 focus:ring-white/70 backdrop-blur-sm"
            />
            <button
              onClick={searchManga}
              className="px-5 py-3 rounded-2xl font-semibold bg-gradient-to-r from-gray-700 to-gray-600 hover:scale-105 transform transition"
            >
              Search
            </button>
            {results.length > 0 && (
              <button
                onClick={clearResults}
                className="px-5 py-3 rounded-2xl font-semibold bg-gradient-to-r from-gray-600 to-gray-700 hover:scale-105 transform transition"
              >
                Clear
              </button>
            )}
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
                  >
                    ➕ Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Storage Section */}
        <div>
          <h2 className="text-2xl font-bold mb-6 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            My Library
          </h2>
          <div className="grid sm:grid-cols-3 md:grid-cols-4 gap-6">
            {library.map((manga) => (
              <div
                key={manga.mal_id}
                className="bg-gradient-to-br from-gray-800/90 to-gray-900/90 rounded-2xl p-4 flex flex-col shadow-lg backdrop-blur-sm hover:scale-105 transform transition justify-between"
              >
                <img
                  src={manga.image_url_jpg}
                  alt={manga.name}
                  className="rounded-lg mb-3 shadow-md"
                />
                <div>
                  <h3 className="font-semibold">{manga.title}</h3>
                  <p className="text-xs text-gray-400">
                    Volumes: {manga.volumes ?? "?"}
                  </p>
                  <p className="text-xs text-gray-400">
                    Volumes owned: {manga.volumes_owned}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
