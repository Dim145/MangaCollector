import React, {useContext} from "react";
import SettingsContext from "@/SettingsContext.js";
import {hasToBlurImage} from "@/utils/library.js";

export default function MangaSearchResults({
  results,
  addToLibrary,
  isAdding
}) {
  const {adult_content_level} = useContext(SettingsContext);

  if (results.length === 0) {
    return null;
  }

  return (
    <div
      className="mt-4 w-full overflow-y-auto bg-black/80 hover:bg-black/90 backdrop-blur-lg border border-white/20 rounded-2xl shadow-2xl transition-all duration-300"
      style={{ maxHeight: "calc(100lvh - 250px)" }}
    >
      {results.map((manga) => (
        <div
          key={manga.mal_id}
          className="flex items-center gap-3 p-3 hover:bg-white/5 transition-all duration-200 group border-b border-white/5 last:border-b-0"
        >
          {/* Manga Cover Image */}
          <div className="relative overflow-hidden rounded-md">
            <img
              src={manga.images.jpg.image_url}
              alt={manga.title}
              className={`h-24 w-auto rounded-md shadow-lg group-hover:scale-105 transition-transform duration-300 ${hasToBlurImage({genres: manga.genres.map(g => g.name)}, adult_content_level) ? "blur-sm" : ""}`}
            />
            <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-md" />
          </div>

          {/* Manga Information */}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white group-hover:text-gray-100 transition-colors truncate">
              {manga.title}
            </p>
            <p className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors">
              Volumes: {manga.volumes ?? "?"}
            </p>
          </div>

          {/* Add Button */}
          <button
            onClick={() => addToLibrary(manga)}
            className={`
              px-4 py-2 bg-white text-black text-xs font-semibold rounded-lg
              hover:bg-gray-200 hover:scale-105 active:scale-95
              transform transition-all duration-200 shadow-lg hover:shadow-xl
              disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
              ${isAdding ? "animate-pulse" : ""}
            `}
            disabled={isAdding}
          >
            {isAdding ? "Adding..." : "Add"}
          </button>
        </div>
      ))}

      {/* Scroll Indicator */}
      {results.length > 5 && (
        <div className="sticky bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-black/80 to-transparent pointer-events-none flex items-center justify-center">
          <div className="w-8 h-0.5 bg-white/30 rounded-full" />
        </div>
      )}
    </div>
  );
}
