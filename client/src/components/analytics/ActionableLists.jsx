import { useNavigate } from "react-router-dom";
import Skeleton from "../ui/Skeleton.jsx";
import { useT } from "@/i18n/index.jsx";

/**
 * Two side-by-side lists of "things to do" about the collection:
 *   - middleGaps: series with unowned volumes sitting between owned ones
 *     ("tu as le 3 et le 5, il te manque le 4")
 *   - stale: series with no new volume acquired in 6+ months
 *
 * Both list rows are clickable and jump to the series page so the user
 * can act on the insight immediately.
 */
export default function ActionableLists({ middleGaps, stale, loading, library }) {
  const t = useT();

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <GapsPanel middleGaps={middleGaps} loading={loading} t={t} library={library} />
      <StalePanel stale={stale} loading={loading} t={t} library={library} />
    </div>
  );
}

/* ─────────────────────────── Gaps panel ─────────────────────────── */

function GapsPanel({ middleGaps, loading, t, library }) {
  const navigate = useNavigate();

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
          {t("analytics.gaps.label")}
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
      </div>
      <h3 className="mt-2 font-display text-xl font-semibold italic text-washi">
        {t("analytics.gaps.title")}
      </h3>
      <p className="mt-1 text-xs text-washi-muted">
        {t("analytics.gaps.byline")}
      </p>

      <div className="mt-4 space-y-2">
        {loading ? (
          [...Array(3)].map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border border-border bg-ink-2/40 p-3"
            >
              <Skeleton className="h-12 w-9" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-36" />
                <Skeleton className="h-2.5 w-24" />
              </div>
            </div>
          ))
        ) : middleGaps.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-ink-2/20 p-4 text-center text-sm text-washi-muted">
            {t("analytics.gaps.empty")}
          </p>
        ) : (
          middleGaps.map((g) => {
            const series = library?.find((m) => m.mal_id === g.mal_id);
            return (
              <button
                key={g.mal_id}
                type="button"
                onClick={() =>
                  series &&
                  navigate("/mangapage", { state: { manga: series } })
                }
                className="group flex w-full items-center gap-3 rounded-lg border border-border bg-ink-2/40 p-3 text-left transition hover:border-hanko/40 hover:bg-ink-2/60"
              >
                {g.image_url_jpg ? (
                  <img referrerPolicy="no-referrer"
                    src={g.image_url_jpg}
                    alt=""
                    loading="lazy"
                    className="h-12 w-9 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div
                    className="grid h-12 w-9 shrink-0 place-items-center rounded bg-ink-2 font-display text-xs italic text-washi-dim"
                    title={t("badges.volume")}
                  >
                    巻
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-sm font-semibold text-washi">
                    {g.name}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-hanko-bright">
                    {g.missing.length === 1
                      ? t("analytics.gaps.missingOne", { n: g.missing[0] })
                      : t("analytics.gaps.missingMany", {
                          n: g.missing.length,
                          list: formatList(g.missing),
                        })}
                  </p>
                </div>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4 shrink-0 text-washi-dim transition group-hover:translate-x-0.5 group-hover:text-hanko-bright"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Stale panel ─────────────────────────── */

function StalePanel({ stale, loading, t, library }) {
  const navigate = useNavigate();

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
          {t("analytics.stale.label")}
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
      </div>
      <h3 className="mt-2 font-display text-xl font-semibold italic text-washi">
        {t("analytics.stale.title")}
      </h3>
      <p className="mt-1 text-xs text-washi-muted">
        {t("analytics.stale.byline")}
      </p>

      <div className="mt-4 space-y-2">
        {loading ? (
          [...Array(3)].map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border border-border bg-ink-2/40 p-3"
            >
              <Skeleton className="h-12 w-9" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-36" />
                <Skeleton className="h-2.5 w-20" />
              </div>
            </div>
          ))
        ) : stale.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-ink-2/20 p-4 text-center text-sm text-washi-muted">
            {t("analytics.stale.empty")}
          </p>
        ) : (
          stale.map((s) => {
            const series = library?.find((m) => m.mal_id === s.mal_id);
            return (
              <button
                key={s.mal_id}
                type="button"
                onClick={() =>
                  series &&
                  navigate("/mangapage", { state: { manga: series } })
                }
                className="group flex w-full items-center gap-3 rounded-lg border border-border bg-ink-2/40 p-3 text-left transition hover:border-gold/40 hover:bg-ink-2/60"
              >
                {s.image_url_jpg ? (
                  <img referrerPolicy="no-referrer"
                    src={s.image_url_jpg}
                    alt=""
                    loading="lazy"
                    className="h-12 w-9 shrink-0 rounded object-cover opacity-70 saturate-50 transition group-hover:opacity-100 group-hover:saturate-100"
                  />
                ) : (
                  <div
                    className="grid h-12 w-9 shrink-0 place-items-center rounded bg-ink-2 font-display text-xs italic text-washi-dim"
                    title={t("badges.volume")}
                  >
                    巻
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-sm font-semibold text-washi">
                    {s.name}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-gold">
                    {t("analytics.stale.idle", {
                      n: s.monthsSince,
                      owned: s.ownedCount,
                      total: s.totalCount,
                    })}
                  </p>
                </div>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4 shrink-0 text-washi-dim transition group-hover:translate-x-0.5 group-hover:text-gold"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function formatList(nums) {
  if (nums.length <= 3) return nums.join(", ");
  return `${nums.slice(0, 3).join(", ")}, +${nums.length - 3}`;
}
