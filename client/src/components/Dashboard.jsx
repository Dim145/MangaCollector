import { useState, useEffect } from "react";
import {getUserLibrary, addToUserLibrary, getShowAdultContent} from "../utils/user";
import Manga from "./Manga";
import DefaultBackground from "./DefaultBackground";
import MangaSearchResults from "./MangaSearchResults";
import MangaSearchBar from "./MangaSearchBar";

export default function Dashboard() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [showAdultContent, setShowAdultContent] = useState(false);

  useEffect(() => {
    async function loadLibrary() {
      try {
        const userLibrary = await getUserLibrary();
        setLibrary(userLibrary);
      } catch (err) {
        console.error(err);
      }
    }

    async function fetchSettings() {
      setShowAdultContent(await getShowAdultContent())
    }

    fetchSettings();
    loadLibrary();
  }, [isAdding, loading, results]);

  const searchManga = async () => {
    if (!query.trim()) return;
    try {
      setLoading(true);
      const res = await fetch(
        `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(query)}&limit=10`,
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
        image_url_jpg: manga.images.jpg.large_image_url || manga.images.jpg.image_url,
        genres: (manga.genres || []).filter(g => g.type === "manga").map(g => g.name),
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

      <DefaultBackground>
        <div className="p-8 max-w-6xl mx-auto space-y-12">
          {/* Header */}
          <h1 className="text-3xl font-extrabold text-center bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent tracking-wide">
            Manga Dashboard
          </h1>

          {/* Search Section */}
          <div className="w-full space-y-4">
            <MangaSearchBar
              query={query}
              setQuery={setQuery}
              searchManga={searchManga}
              clearResults={clearResults}
              loading={loading}
              hasResults={results.length > 0}
            />

            {/* Dropdown Results */}
            {results.length > 0 && (
              <MangaSearchResults
                results={results}
                addToLibrary={addToLibrary}
                isAdding={isAdding}
              />
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
                <Manga key={manga.mal_id} manga={manga} showAdultContent={showAdultContent} />
              ))}
            </div>
          </div>
        </div>
      </DefaultBackground>
    </div>
  );
}
