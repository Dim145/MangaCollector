import { lazy, Suspense, useState } from "react";
import Skeleton from "./ui/Skeleton.jsx";
import { useMalRecommendations } from "@/hooks/useMalRecommendations.js";
import { useT } from "@/i18n/index.jsx";
// Only mounts when a tile is clicked — deferred out of the profile chunk.
const MalRecommendationModal = lazy(
  () => import("./MalRecommendationModal.jsx"),
);

/**
 * R2 — "You might also like". Clicking a cover opens a modal that pulls
 * the full MAL details and offers to add the series to the library with
 * a chosen number of owned volumes + price per volume. The modal also
 * surfaces a link to the MyAnimeList page for deeper research.
 */
export default function MalRecommendations() {
  const t = useT();
  const [selected, setSelected] = useState(null);
  const {
    data: recs,
    isLoading,
    hasSources,
    error,
  } = useMalRecommendations({
    sourceLimit: 10,
    limit: 8,
  });

  if (!hasSources) return null;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-washi-dim">
          {t("recs.label")}
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
      </div>
      <h2 className="font-display text-xl font-semibold italic text-washi">
        {t("recs.title")}
      </h2>
      <p className="mt-1 text-xs text-washi-muted">{t("recs.byline")}</p>

      {error === "jikan-rate-limit" && !recs.length && (
        <p className="mt-4 rounded-lg border border-gold/20 bg-gold/5 p-3 text-xs text-washi-muted">
          {t("recs.rateLimited")}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {isLoading && !recs.length
          ? [...Array(4)].map((_, i) => <Skeleton.Card key={i} />)
          : recs.map((rec) => (
              <button
                key={rec.mal_id}
                type="button"
                onClick={() => setSelected(rec)}
                className="group relative block w-full overflow-hidden rounded-lg border border-border bg-ink-2 text-left transition hover:-translate-y-0.5 hover:border-hanko/40 focus-visible:border-hanko"
              >
                {rec.image_url ? (
                  <img referrerPolicy="no-referrer"
                    src={rec.image_url}
                    alt=""
                    loading="lazy"
                    className="aspect-[2/3] w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div
                    className="grid aspect-[2/3] w-full place-items-center font-display text-3xl italic text-hanko/40"
                    title={t("badges.volume")}
                  >
                    巻
                  </div>
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-0 via-ink-0/80 to-transparent p-2">
                  <p className="line-clamp-2 font-display text-[11px] font-semibold leading-tight text-washi">
                    {rec.title}
                  </p>
                  <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-gold">
                    {t("recs.recommendedBy", { n: rec.sourceCount })}
                  </p>
                </div>
                {/* Hover hint */}
                <span className="pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-hanko/90 text-washi opacity-0 shadow-lg transition group-hover:opacity-100">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </button>
            ))}
      </div>

      {selected && (
        <Suspense fallback={null}>
          <MalRecommendationModal
            open={Boolean(selected)}
            rec={selected}
            onClose={() => setSelected(null)}
          />
        </Suspense>
      )}
    </section>
  );
}
