"use client";
import { useState } from "react";

export default function Dashboard() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [storage, setStorage] = useState([]);

  // Search Kitsu API
  const searchManga = async () => {
    if (!query.trim()) return;
    try {
      const res = await fetch(
        `https://kitsu.io/api/edge/manga?filter[text]=${encodeURIComponent(query)}`
      );
      const data = await res.json();
      setResults(data.data || []);
    } catch (err) {
      console.error("Search error:", err);
    }
  };

  // Add to storage
  const addToStorage = (manga) => {
    if (storage.some((m) => m.id === manga.id)) return; // prevent dupes
    setStorage([...storage, manga]);
  };

  return (
    <div className="bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 min-h-screen text-white p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Search Section */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search manga..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 px-4 py-2 rounded-xl bg-gray-800 text-white border border-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={searchManga}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold"
          >
            Search
          </button>
        </div>

        {/* Search Results */}
        <div>
          <h2 className="text-xl font-bold mb-4">Search Results</h2>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
            {results.map((manga) => (
              <div
                key={manga.id}
                className="bg-gray-800 rounded-xl p-4 flex flex-col shadow hover:shadow-lg"
              >
                <img
                  src={manga.attributes.posterImage?.small}
                  alt={manga.attributes.canonicalTitle}
                  className="rounded-lg mb-3"
                />
                <h3 className="font-semibold text-lg mb-2">
                  {manga.attributes.canonicalTitle}
                </h3>
                <button
                  onClick={() => addToStorage(manga)}
                  className="mt-auto px-3 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium"
                >
                  ➕ Add to Storage
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Storage Section */}
        <div>
          <h2 className="text-xl font-bold mb-4">My Storage</h2>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
            {storage.map((manga) => (
              <div
                key={manga.id}
                className="bg-gray-700 rounded-xl p-4 flex flex-col"
              >
                <img
                  src={manga.attributes.posterImage?.tiny}
                  alt={manga.attributes.canonicalTitle}
                  className="rounded mb-2"
                />
                <h3 className="font-semibold">{manga.attributes.canonicalTitle}</h3>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
