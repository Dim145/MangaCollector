import { useContext, useState } from "react";
import SettingsContext from "@/SettingsContext.js";
import { hasToBlurImage } from "@/utils/library.js";
import Modal from "@/components/ui/Modal.jsx";
import { useT } from "@/i18n/index.jsx";

/**
 * Renders unified search results coming from `/api/external/search`.
 * Each item has:
 *   - source: "mal" | "mangadex" | "both"
 *   - mal_id and/or mangadex_id
 *   - flat name / image_url / genres / volumes / score
 *
 * `addToLibrary(result)` is the parent's entry point — it decides whether to
 * directly add (MAL / both → known volume count) or prompt for a volume count
 * first (pure MangaDex, which rarely publishes lastVolume).
 */
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
      {/* Standalone results panel on AddPage (not inside a Modal) —
          keeps its own blur but `md` is sufficient on a small panel. */}
      <div className="overflow-hidden rounded-2xl border border-border bg-ink-1/85 backdrop-blur-md shadow-2xl animate-fade-up">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
            {t("searchResults.matches", { n: results.length })}
          </span>
          <span className="rounded-full bg-hanko/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-hanko-bright">
            MAL + MangaDex
          </span>
        </div>

        <ul
          className="max-h-[60vh] overflow-y-auto divide-y divide-border"
          role="listbox"
        >
          {results.map((result) => {
            const blurImage = hasToBlurImage(
              { genres: result.genres ?? [] },
              adult_content_level,
            );
            const inLib = isInLibrary(result);
            // Compose a stable key even when mal_id is missing (pure MangaDex).
            const key = result.mal_id
              ? `mal-${result.mal_id}`
              : `md-${result.mangadex_id}`;

            return (
              <li
                key={key}
                className="group flex items-center gap-3 px-3 py-3 transition-colors hover:bg-washi/5 sm:gap-4 sm:px-4"
              >
                {/* Cover */}
                <button
                  onClick={() => !blurImage && setImgUrl(result.image_url)}
                  disabled={blurImage || !result.image_url}
                  aria-label={result.name}
                  className="relative flex-shrink-0 overflow-hidden rounded-md border border-border shadow-md"
                >
                  {result.image_url ? (
                    <img
                      src={result.image_url}
                      alt=""
                      loading="lazy"
                      className={`h-20 w-14 object-cover transition-transform duration-300 group-hover:scale-110 sm:h-24 sm:w-16 ${
                        blurImage ? "blur-md" : ""
                      }`}
                    />
                  ) : (
                    <div className="grid h-20 w-14 place-items-center bg-ink-2 sm:h-24 sm:w-16">
                      <span
                        className="font-display text-2xl italic text-hanko/40"
                        title={t("badges.volume")}
                      >
                        巻
                      </span>
                    </div>
                  )}
                </button>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 font-display text-sm font-semibold text-washi line-clamp-2 sm:text-base">
                      {result.name}
                    </p>
                    <SourceBadge source={result.source} t={t} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] uppercase tracking-wider text-washi-dim">
                    <span>
                      {t("searchResults.vols", {
                        n: result.volumes ?? "?",
                      })}
                    </span>
                    {result.score && (
                      <>
                        <span className="h-0.5 w-0.5 rounded-full bg-washi-dim" />
                        <span className="text-gold">★ {result.score}</span>
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
                      onClick={() => addToLibrary(result)}
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

/* ─────────────────── Source badge ──────────────────── */
function SourceBadge({ source, t }) {
  if (source === "both") {
    return (
      <span
        className="shrink-0 rounded-full bg-gradient-to-br from-hanko/20 to-gold/20 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-washi"
        title={t("searchResults.sourceBothTitle")}
      >
        M+D
      </span>
    );
  }
  if (source === "mangadex") {
    return (
      <span
        className="shrink-0 rounded-full bg-gold/15 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-gold"
        title="MangaDex"
      >
        MD
      </span>
    );
  }
  // default: MAL
  return (
    <span
      className="shrink-0 rounded-full bg-hanko/15 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-hanko-bright"
      title="MyAnimeList"
    >
      MAL
    </span>
  );
}
