import {useState, useEffect, useContext} from "react";
import {
  getUserLibrary,
  searchInLib,
} from "../utils/user";
import Manga from "./Manga";
import DefaultBackground from "./DefaultBackground";
import MangaSearchBar from "./MangaSearchBar";
import SettingsContext from "@/SettingsContext.js";
import {useNavigate} from "react-router-dom";
import {filterAdultGenreIfNeeded} from "@/utils/library.js";

export default function Dashboard() {
  const [query, setQuery] = useState("");
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(false);
  const {adult_content_level} = useContext(SettingsContext);
  const [libraryFiltered, setLibraryFiltered] = useState(false);

  const navigate = useNavigate();

  const loadLibrary = async () => {
    try {
      const userLibrary = filterAdultGenreIfNeeded(adult_content_level, await getUserLibrary());
      setLibrary(userLibrary);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    loadLibrary();
  }, []);

  const searchManga = async () => {
    if (!query.trim())
    {
      await loadLibrary();
      setLibraryFiltered(false);
      return;
    }

    try {
      setLoading(true);

      setLibrary(await searchInLib(query));
      setLibraryFiltered(true);
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setLoading(false);
    }
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
              loading={loading}
              placeholder="Search manga in library..."
              clearResults={() => loadLibrary().then(() => setLibraryFiltered(false)).then(() => setQuery(""))}
              hasResults={libraryFiltered}
              clearText="Clear filters"
            />
          </div>

          {/* Storage Section */}
          <div>
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold mb-2 text-white">My Library</h2>
                <p className="text-2xs mb-4 text-gray-300/75">
                  Click on any manga to enter more information
                </p>
              </div>

              <button
                onClick={() => navigate("/addmanga")}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg mb-4"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
              {library.map((manga) => (
                <Manga
                  key={manga.mal_id}
                  manga={manga}
                  adult_content_level={adult_content_level}
                />
              ))}
            </div>
          </div>
        </div>
      </DefaultBackground>
    </div>
  );
}
