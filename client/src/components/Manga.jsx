import { useNavigate } from "react-router-dom";
import CoverImage from "./ui/CoverImage.jsx";
import { hasToBlurImage } from "@/utils/library.js";
import { useT } from "@/i18n/index.jsx";

export default function Manga({
  manga,
  adult_content_level,
  allCollector,
  tsundokuCount = 0,
}) {
  const navigate = useNavigate();
  const t = useT();

  const owned = manga.volumes_owned ?? 0;
  const total = manga.volumes ?? 0;
  const completion = total > 0 ? Math.min(100, (owned / total) * 100) : 0;
  const blur = hasToBlurImage(manga, adult_content_level);
  const complete = total > 0 && owned >= total;

  return (
    <button
      onClick={() =>
        navigate("/mangapage", { state: { manga, adult_content_level } })
      }
      className="group relative flex flex-col text-left tap-none focus-visible:outline-none"
    >
      {/* Cover — tall aspect like a real manga volume */}
      <div
        className={`relative aspect-[2/3] w-full overflow-hidden rounded-lg border border-border bg-ink-2 shadow-lg transition-all duration-500 group-hover:shadow-2xl group-hover:-translate-y-1 ${
          allCollector
            ? "group-hover:border-gold/60"
            : complete
              ? "group-hover:border-moegi/60"
              : "group-hover:border-hanko/50"
        }`}
      >
        {/* CoverImage falls back to the 巻 placeholder when the URL is
            missing OR the image errors out (404, CORS, timeout, etc.).
            Without this, a broken cover left the card visually empty
            and the user couldn't spot the click target to open the
            series and fix its cover via the picker. */}
        <CoverImage
          src={manga.image_url_jpg}
          alt=""
          blur={blur}
          imgClassName="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
        />
        {/* Tooltip-target for the placeholder — only meaningful when
            the fallback is visible, i.e. no URL or failed load. */}
        {!manga.image_url_jpg && (
          <span className="sr-only" title={t("badges.volume")}>
            {t("badges.volume")}
          </span>
        )}

        {/* Top gradient for badge readability */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-ink-0/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

        {/* Bottom gradient overlay */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink-0 via-ink-0/60 to-transparent" />

        {/* Collector seal (top-left) — every owned volume is collector */}
        {allCollector && (
          <div
            className="absolute top-2 left-2 z-10 grid h-4 w-4 place-items-center rounded-sm bg-gold/85 text-ink-0 shadow-[0_1px_3px_rgba(10,9,8,0.4)] opacity-80 transition group-hover:opacity-100"
            style={{ transform: "rotate(-6deg)" }}
            title={t("manga.allCollector")}
            aria-label={t("manga.allCollector")}
          >
            <span className="font-display text-[8px] font-bold leading-none">
              限
            </span>
          </div>
        )}

        {/* Tsundoku counter — top-left cluster, sitting next to the
            collector seal (which is h-4 w-4). When a collector seal is
            present we shift right by ~24px to clear it; otherwise we
            occupy the primary top-left slot. This keeps the right-hand
            corner free for the completion badge so the two visual
            languages (reading axis vs. collection axis) stop colliding. */}
        {tsundokuCount > 0 && (
          <div
            className={`absolute top-2 z-10 inline-flex items-center gap-0.5 rounded-sm border border-moegi/50 bg-ink-0/70 px-1 py-0.5 text-moegi shadow-[0_1px_3px_rgba(10,9,8,0.4)] opacity-80 transition group-hover:opacity-100 ${
              allCollector ? "left-8" : "left-2"
            }`}
            style={{ transform: "rotate(3deg)" }}
            title={t("manga.tsundokuHint", { n: tsundokuCount })}
            aria-label={t("manga.tsundokuHint", { n: tsundokuCount })}
          >
            <span className="font-jp text-[9px] font-bold leading-none">
              積
            </span>
            <span className="font-mono text-[9px] font-bold leading-none tabular-nums">
              {tsundokuCount}
            </span>
          </div>
        )}

        {/* Status badge (top-right) — mutually exclusive states.
            COMPLETE: solid moegi pill + ✓. The achievement state, loud.
            ONGOING : muted hanko outline + ◐ half-disc glyph. Quiet but
                      explicit, so series state is visible without relying
                      solely on the bottom-bar progress bar. Without this
                      pair, "ongoing" was encoded only by the *absence* of a
                      badge — a colour-only cue that's invisible to anyone
                      who can't tell hanko-red from moegi-green. */}
        {complete ? (
          <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-gradient-to-br from-moegi to-moegi-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-0 shadow-md">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-2.5 w-2.5"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {t("manga.complete")}
          </div>
        ) : total > 0 ? (
          <div
            className="absolute top-2 right-2 flex items-center gap-1 rounded-full border border-hanko/50 bg-ink-0/65 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-hanko-bright shadow-[0_1px_3px_rgba(10,9,8,0.4)] opacity-80 backdrop-blur transition group-hover:opacity-100"
            aria-label={t("manga.ongoing")}
          >
            {/* Half-filled disc — the universal "in progress" glyph.
                Outer circle = total target, filled half = work landed. */}
            <svg
              viewBox="0 0 16 16"
              className="h-2.5 w-2.5"
              aria-hidden="true"
            >
              <circle
                cx="8"
                cy="8"
                r="6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="M8 2.5 A5.5 5.5 0 0 1 8 13.5 Z"
                fill="currentColor"
              />
            </svg>
            {t("manga.ongoing")}
          </div>
        ) : null}

        {/* Title + meta absolute bottom */}
        <div className="absolute inset-x-0 bottom-0 p-3">
          <h3 className="font-display text-sm font-semibold text-washi leading-tight line-clamp-2 drop-shadow-md">
            {manga.name}
          </h3>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-washi-muted">
              <span className="text-hanko-bright">{owned}</span>
              <span className="text-washi-dim"> / {total || "?"}</span>
            </span>
            <span className="text-[10px] font-medium text-washi-dim">
              {t("manga.volumesShort")}
            </span>
          </div>

          {/* Progress bar */}
          {total > 0 && (
            <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-washi/15">
              <div
                className={`h-full transition-all duration-500 ${
                  complete
                    ? "bg-gradient-to-r from-moegi to-moegi-muted"
                    : "bg-gradient-to-r from-hanko to-hanko-bright"
                }`}
                style={{ width: `${completion}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
