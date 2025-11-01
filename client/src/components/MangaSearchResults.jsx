import React, {Fragment, useContext} from "react";
import SettingsContext from "@/SettingsContext.js";
import {hasToBlurImage} from "@/utils/library.js";
import Modal from "@/components/utils/Modal.jsx";

export default function MangaSearchResults({
  results,
  addToLibrary,
  isAdding,
  isInLibrary
}) {
  const [imgUrl, setImgUrl] = React.useState(undefined);

  const {adult_content_level} = useContext(SettingsContext);

  if (results.length === 0) {
    return null;
  }

  return <Fragment>
    <div
      className="mt-4 w-full overflow-y-auto bg-black/80 hover:bg-black/90 backdrop-blur-lg border border-white/20 rounded-2xl shadow-2xl transition-all duration-300"
      style={{ maxHeight: "calc(100lvh - 250px)" }}
    >
      {results.map((manga) => {
        const blurImage = hasToBlurImage({genres: manga.genres.map(g => g.name)}, adult_content_level);

        return <div
          key={manga.mal_id}
          className="flex items-center gap-3 p-3 hover:bg-white/5 transition-all duration-200 group border-b border-white/5 last:border-b-0"
        >
          {/* Manga Cover Image */}
          <div className="relative overflow-hidden rounded-md">
            <img
              src={manga.images.jpg.image_url}
              alt={manga.title}
              className={`h-24 w-auto rounded-md shadow-lg group-hover:scale-105 transition-transform duration-300 ${blurImage ? "blur-sm" : "cursor-pointer"}`}
            />
            <div
              className={`absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-md ${!blurImage ? "cursor-pointer" : ""}`}
              onClick={() => !blurImage && setImgUrl(manga.images.jpg.large_image_url)}
            />
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
          {isInLibrary(manga.mal_id) ? <Fragment>
            <span className="text-green-500 px-4 py-2">
              <svg xmlns="http://www.w3.org/2000/svg"
                   fill="none"
                   viewBox="0 0 24 24"
                   strokeWidth={1.5}
                   stroke="currentColor"
                   className="size-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </span>
          </Fragment> : <button
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
          </button>}
        </div>
      })}

      {/* Scroll Indicator */}
      {results.length > 5 && (
        <div className="sticky bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-black/80 to-transparent pointer-events-none flex items-center justify-center">
          <div className="w-8 h-0.5 bg-white/30 rounded-full" />
        </div>
      )}
    </div>

    <Modal
      popupOpen={imgUrl}
      handleClose={() => setImgUrl(undefined)}
      additionalClasses="m-2"
    >
      <img
        src={`${imgUrl}`}
        alt="poster"
        style={{
          maxHeight: 'calc(100vh - 150px)',
          height: '100vh'
        }}
        className="max-w-full object-contain rounded-lg shadow-lg"
      />
    </Modal>
  </Fragment>;
}
