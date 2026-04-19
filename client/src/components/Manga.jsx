import { useNavigate } from "react-router-dom";
import { hasToBlurImage } from "@/utils/library.js";

export default function Manga({ manga, adult_content_level }) {
  const navigate = useNavigate();

  const owned = manga.volumes_owned ?? 0;
  const total = manga.volumes ?? 0;
  const completion = total > 0 ? Math.min(100, (owned / total) * 100) : 0;
  const blur = hasToBlurImage(manga, adult_content_level);
  const complete = total > 0 && owned >= total;

  return (
    <button
      onClick={() => navigate("/mangapage", { state: { manga, adult_content_level } })}
      className="group relative flex flex-col text-left tap-none focus-visible:outline-none"
    >
      {/* Cover — tall aspect like a real manga volume */}
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg border border-border bg-ink-2 shadow-lg transition-all duration-500 group-hover:shadow-2xl group-hover:border-hanko/50 group-hover:-translate-y-1">
        {manga.image_url_jpg ? (
          <img
            src={manga.image_url_jpg}
            alt=""
            loading="lazy"
            className={`h-full w-full object-cover transition-transform duration-700 group-hover:scale-110 ${
              blur ? "blur-md" : ""
            }`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink-2 to-ink-3">
            <span className="font-display text-4xl italic text-hanko/40">
              巻
            </span>
          </div>
        )}

        {/* Top gradient for badge readability */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-ink-0/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

        {/* Bottom gradient overlay */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink-0 via-ink-0/60 to-transparent" />

        {/* Status badge (top-right) */}
        {complete && (
          <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-gold/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-0 shadow-md">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-2.5 w-2.5"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Complete
          </div>
        )}

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
              vols
            </span>
          </div>

          {/* Progress bar */}
          {total > 0 && (
            <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full transition-all duration-500 ${
                  complete
                    ? "bg-gradient-to-r from-gold to-gold-muted"
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
