import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import Modal from "@/components/ui/Modal.jsx";
import CoverImage from "@/components/ui/CoverImage.jsx";
import { db } from "@/lib/db.js";
import { seriesForUpcoming } from "@/lib/upcomingPicker.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 来 · First step of noting an upcoming volume from the calendar: which
 * series is it for?
 *
 * The series page opens the upcoming form on its own series; the
 * calendar has none, so the reader picks one here and the same form
 * (`AddUpcomingVolumeModal`) takes over with the next number proposed.
 * Everything listed comes from the device cache, so the list is there
 * at once; only the save that follows needs the server.
 *
 * `onPick({ manga, highest })` hands over the series and the highest
 * volume number known for it.
 */
export default function UpcomingSeriesPicker({ open, onClose, onPick }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);

  const library = useLiveQuery(() => db.library.toArray(), []);
  const volumes = useLiveQuery(() => db.volumes.toArray(), []);
  const loading = library === undefined || volumes === undefined;

  const rows = useMemo(
    () => seriesForUpcoming(library, volumes, query),
    [library, volumes, query],
  );
  const libraryEmpty = !loading && (library?.length ?? 0) === 0;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  return (
    <Modal popupOpen={open} handleClose={onClose}>
      <div className="relative flex max-h-[min(40rem,85dvh)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-moegi/30 bg-gradient-to-br from-ink-1 via-ink-1 to-moegi/[0.04] p-6 shadow-2xl">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-6 -top-6 select-none font-jp text-[14rem] font-bold leading-none text-moegi/[0.06]"
          style={{ writingMode: "vertical-rl" }}
        >
          来
        </span>

        <div className="relative z-10 flex items-start gap-4">
          <span
            aria-hidden="true"
            className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-gradient-to-br from-moegi to-moegi-muted text-ink-0 shadow-[0_4px_14px_rgba(163,201,97,0.45)]"
            style={{ transform: "rotate(-3deg)" }}
          >
            <span className="font-jp text-2xl font-bold leading-none">来</span>
          </span>
          <div className="min-w-0 pt-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-moegi-muted">
              {t("manga.upcomingModalEyebrow")}
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold italic leading-tight text-washi">
              {t("calendar.pickSeriesTitle")}
            </h2>
            <p className="mt-1 text-xs text-washi-muted">
              {t("calendar.pickSeriesLead")}
            </p>
          </div>
        </div>

        {libraryEmpty ? (
          <div className="relative z-10 mt-6 rounded-xl border border-dashed border-border p-5 text-center">
            <p className="text-sm text-washi-muted">{t("calendar.pickSeriesNoLibrary")}</p>
            <Link
              to="/addmanga"
              onClick={onClose}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-moegi/40 bg-moegi/5 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-moegi transition hover:border-moegi hover:bg-moegi/15 pointer-coarse:min-h-11"
            >
              {t("calendar.pickSeriesAddCta")}
            </Link>
          </div>
        ) : (
          <>
            <label className="group relative z-10 mt-5 block">
              <span className="sr-only">{t("calendar.pickSeriesSearch")}</span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-washi-dim transition-colors group-focus-within:text-moegi"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="20" y1="20" x2="16.5" y2="16.5" />
              </svg>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Enter on a narrowed list takes the only answer.
                  if (e.key === "Enter" && rows.length === 1) {
                    e.preventDefault();
                    onPick(rows[0]);
                  }
                }}
                placeholder={t("calendar.pickSeriesSearch")}
                className="w-full rounded-full border border-border bg-ink-0/40 py-2 pl-9 pr-4 text-sm text-washi placeholder:text-washi-dim transition focus:border-moegi/50 focus:outline-none focus:ring-2 focus:ring-moegi/20 pointer-coarse:py-3"
              />
            </label>

            <ul
              className="relative z-10 -mx-2 mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2"
              aria-busy={loading}
            >
              {!loading && rows.length === 0 && (
                <li className="py-6 text-center text-sm text-washi-muted">
                  {t("calendar.pickSeriesNoMatch")}
                </li>
              )}
              {rows.map((row) => (
                <li key={row.manga.mal_id}>
                  <button
                    type="button"
                    onClick={() => onPick(row)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-moegi/10 focus-visible:bg-moegi/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moegi/40 pointer-coarse:min-h-11"
                  >
                    {/* The wrapper holds both axes: CoverImage renders
                        `h-full w-full`, which would otherwise take the
                        whole row and crush the name beside it. */}
                    <span
                      aria-hidden="true"
                      className="relative grid h-12 w-8 shrink-0 place-items-center overflow-hidden rounded-sm border border-border/60 bg-gradient-to-br from-ink-2 to-ink-3"
                    >
                      {row.manga.image_url_jpg ? (
                        <CoverImage
                          src={row.manga.image_url_jpg}
                          sizes="32px"
                          alt=""
                          className="absolute inset-0"
                          imgClassName="h-full w-full object-cover"
                          paletteSeed={row.manga.mal_id}
                          width={32}
                          height={48}
                        />
                      ) : (
                        // A stand-in for a missing cover: decorative, so
                        // a watermark's opacity and hidden from readers.
                        <span
                          aria-hidden="true"
                          className="font-display text-sm italic text-hanko-bright/40"
                        >
                          巻
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-sm font-semibold text-washi">
                        {row.manga.name}
                      </span>
                      <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-moegi-muted">
                        {t("calendar.pickSeriesNext", { n: row.next })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="relative z-10 mt-4 flex">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-washi-muted transition hover:text-washi pointer-coarse:min-h-11"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
