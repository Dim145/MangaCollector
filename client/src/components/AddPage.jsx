import MangaSearchBar from "@/components/MangaSearchBar.jsx";
import MangaSearchResults from "@/components/MangaSearchResults.jsx";
import React, {Fragment, useContext, useEffect, useState} from "react";
import {addCustomEntryToUserLibrary, addToUserLibrary, getUserLibrary} from "@/utils/user.js";
import {useNavigate} from "react-router-dom";
import SettingsContext from "@/SettingsContext.js";

export default function AddPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [library, setLibrary] = useState([]);

  // state for custom entries
  const [customEntry, setCustomEntry] = useState(false);
  const [customEntryTitle, setCustomEntryTitle] = useState("");
  const [customEntryGenres, setCustomEntryGenres] = useState("");
  const [customEntryVolumes, setCustomEntryVolumes] = useState(0);

  const {"show-adult-content": showAdultContent} = useContext(SettingsContext);
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

  const handleSaveCustomEntry = async () => {
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
    }

    const res = await addCustomEntryToUserLibrary(mangaData);

    if(res.success)
    {
      navigate("/mangapage", { state: { manga: res.newEntry, showAdultContent } })
    }
  }

  return <div className="relative text-white overflow-hidden p-8 max-w-6xl mx-auto space-y-12">
    <div className="w-full space-y-4">
      <MangaSearchBar
        query={query}
        setQuery={(val) => {
          setQuery(val);
          setCustomEntryTitle(val);
          setCustomEntryTitle(val);
          setCustomEntry(false);
        }}
        searchManga={searchManga}
        clearResults={clearResults}
        loading={loading}
        hasResults={results.length > 0}
        additionalButtons={<button
          onClick={() => setCustomEntry(!customEntry)}
          title="Add Custom Entry"
          className={`
              flex-1 sm:flex-none px-5 py-3 rounded-2xl font-semibold text-white
              bg-blue-600 hover:bg-blue-700 active:bg-gray-300
              hover:scale-105 active:scale-95 transform transition-all duration-200
              shadow-lg hover:shadow-xl
              disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
            `}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
          </svg>
        </button>}
      />

      {/* Dropdown Results or custom entry */}
      {customEntry ? <Fragment>
        <h2 className="text-2xl font-bold mb-2 text-white">Add Custom Entry</h2>
        <p className="text-2xs mb-4 text-gray-300/75">
          Custom entries allow you to add manga that may not be listed on MyAnimeList or to track physical manga that you own.
        </p>

        <div className="max-w-3xl mx-auto p-6 bg-opacity-80 mt-10 rounded-2xl bg-gradient-to-br from-gray-800/90 to-gray-900/90 shadow-lg backdrop-blur-sm hover:scale-[1.02] transform transition text-white">
          Title:
          <input
            type="text"
            className="w-full p-2 rounded-md mb-4"
            value={customEntryTitle}
            onChange={(e) => setCustomEntryTitle(e.target.value)}
            placeholder="Enter manga title"
          />

         Genres (comma separated):
          <input
            type="text"
            className="w-full p-2 rounded-md mb-4"
            placeholder="e.g., Action, Adventure, Fantasy"
            value={customEntryGenres}
            onChange={(e) => setCustomEntryGenres(e.target.value)}
          />

          Number of Volumes:
          <input
            type="number"
            className="w-full p-2 rounded-md mb-4"
            value={customEntryVolumes}
            onChange={(e) => setCustomEntryVolumes(Number(e.target.value))}
            min={0}
          />

          <div className="text-right gap-4 mt-6">
            <button
              onClick={handleSaveCustomEntry}
              className={`
                px-6 py-3 rounded-2xl font-semibold text-white
                bg-green-600 hover:bg-green-700 active:bg-green-800
                hover:scale-105 active:scale-95 transform transition-all duration-200
                shadow-lg hover:shadow-xl
              `}
            >
              Save Custom Entry
            </button>
          </div>
        </div>
      </Fragment> : results.length > 0 && (
        <MangaSearchResults
          results={results}
          addToLibrary={addToLibrary}
          isAdding={isAdding}
        />
      )}
    </div>
  </div>;
}
