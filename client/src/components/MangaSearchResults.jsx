import { useContext, useState } from "react";
import SettingsContext from "@/SettingsContext.js";
import { hasToBlurImage } from "@/utils/library.js";
import Modal from "@/components/utils/Modal.jsx";
import { useT } from "@/i18n/index.jsx";

export default function MangaSearchResults({
  results,
  addToLibrary,
  isAdding,
  isInLibrary,
}) {
  const [imgUrl, setImgUrl] = useState(undefined);
  const { adult_content_level } = useContext(SettingsContext);
  const t = useT();

  if (!results?.length) return null;

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-border bg-ink-1/80 backdrop-blur-xl shadow-2xl animate-fade-up">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
            {t("searchResults.matches", { n: results.length })}
          </span>
          <span className="rounded-full bg-hanko/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-hanko-bright">
            MyAnimeList
          </span>
        </div>

        <ul
          className="max-h-[60vh] overflow-y-auto divide-y divide-border"
          role="listbox"
        >
          {results.map((manga) => {
            const blurImage = hasToBlurImage(
              { genres: manga.genres.map((g) => g.name) },
              adult_content_level,
            );
            const inLib = isInLibrary(manga.mal_id);

            return (
              <li
                key={manga.mal_id}
                className="group flex items-center gap-3 px-3 py-3 transition-colors hover:bg-washi/5 sm:gap-4 sm:px-4"
              >
                {/* Cover */}
                <button
                  onClick={() =>
                    !blurImage && setImgUrl(manga.images.jpg.large_image_url)
                  }
                  disabled={blurImage}
                  aria-label={manga.title}
                  className="relative flex-shrink-0 overflow-hidden rounded-md border border-border shadow-md"
                >
                  <img
                    src={manga.images.jpg.image_url}
                    alt=""
                    loading="lazy"
                    className={`h-20 w-14 object-cover transition-transform duration-300 group-hover:scale-110 sm:h-24 sm:w-16 ${
                      blurImage ? "blur-md" : ""
                    }`}
                  />
                </button>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="font-display text-sm font-semibold text-washi line-clamp-2 sm:text-base">
                    {manga.title}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] uppercase tracking-wider text-washi-dim">
                    <span>
                      {t("searchResults.vols", { n: manga.volumes ?? "?" })}
                    </span>
                    {manga.status && (
                      <>
                        <span className="h-0.5 w-0.5 rounded-full bg-washi-dim" />
                        <span>{manga.status}</span>
                      </>
                    )}
                    {manga.score && (
                      <>
                        <span className="h-0.5 w-0.5 rounded-full bg-washi-dim" />
                        <span className="text-gold">★ {manga.score}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Action */}
                <div className="flex-shrink-0">
                  {inLib ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gold"
                      title={t("searchResults.owned")}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3 w-3"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {t("searchResults.owned")}
                    </span>
                  ) : (
                    <button
                      onClick={() => addToLibrary(manga)}
                      disabled={isAdding}
                      className="inline-flex items-center gap-1 rounded-full bg-hanko px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-washi transition hover:bg-hanko-bright active:scale-95 disabled:opacity-50"
                    >
                      {isAdding ? (
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-washi/30 border-t-washi" />
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-3 w-3"
                        >
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      )}
                      {t("common.add")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <Modal
        popupOpen={Boolean(imgUrl)}
        handleClose={() => setImgUrl(undefined)}
        additionalClasses=""
      >
        <img
          src={imgUrl}
          alt="poster"
          className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
        />
      </Modal>
    </>
  );
}
