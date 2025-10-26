import MangaSearchBar from "@/components/MangaSearchBar.jsx";
import MangaSearchResults from "@/components/MangaSearchResults.jsx";
import {useEffect, useState} from "react";
import {addToUserLibrary, getUserLibrary} from "@/utils/user.js";

export default function AddPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
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
        image_url_jpg:
          manga.images.jpg.large_image_url || manga.images.jpg.image_url,
        genres: (manga.genres || [])
          .concat(manga.explicit_genres || [])
          .concat(manga.demographics || [])
          .filter((g) => g.type === "manga")
          .map((g) => g.name),
      };

      if (library.some((m) => m.mal_id === mangaData.mal_id)) {
        console.log("Already in library");
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
  };

  return <div className="relative text-white overflow-hidden p-8 max-w-6xl mx-auto space-y-12">
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
  </div>;
}
