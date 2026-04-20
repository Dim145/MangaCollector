import { useContext, useEffect, useRef, useState } from "react";
import Modal from "@/components/utils/Modal.jsx";
import Skeleton from "@/components/ui/Skeleton.jsx";
import SettingsContext from "@/SettingsContext.js";
import { useAddManga } from "@/hooks/useLibrary.js";
import { useScanCommit } from "@/hooks/useScanCommit.js";
import { useT } from "@/i18n/index.jsx";

/**
 * Add-from-recommendation modal. Fetches the full MAL details for the
 * clicked rec (so we get genres + authoritative volume count), then lets
 * the user specify how many volumes they already own and the price paid
 * per volume before committing to the library.
 *
 * Mirrors the ScanMatchCard visual structure — same card layout, same
 * cover/title header, same big action buttons at the bottom.
 */
export default function MalRecommendationModal({
  open,
  rec,
  onClose,
  onAdded,
}) {
  const t = useT();
  const { currency: currencySetting } = useContext(SettingsContext);
  const addManga = useAddManga();
  const commitScan = useScanCommit();

  const [fullData, setFullData] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const fetchedForRef = useRef(null);

  const [ownedCount, setOwnedCount] = useState(0);
  const [price, setPrice] = useState(0);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState(null);
  const [done, setDone] = useState(false);

  // Reset local state when a new rec is opened
  useEffect(() => {
    if (!open) return;
    setOwnedCount(0);
    setPrice(0);
    setCommitting(false);
    setCommitError(null);
    setDone(false);
    setFetchError(null);
    // Only fetch fresh data when rec changed
    if (fetchedForRef.current !== rec?.mal_id) {
      setFullData(null);
    }
  }, [open, rec?.mal_id]);

  // Fetch full MAL details on open
  useEffect(() => {
    if (!open || !rec?.mal_id) return;
    if (fetchedForRef.current === rec.mal_id && fullData) return;
    let cancelled = false;
    setFetching(true);
    setFetchError(null);
    (async () => {
      try {
        const res = await fetch(
          `https://api.jikan.moe/v4/manga/${rec.mal_id}`,
          { headers: { Accept: "application/json" } },
        );
        if (!res.ok) throw new Error(`Jikan ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        fetchedForRef.current = rec.mal_id;
        setFullData(data.data);
      } catch (err) {
        if (!cancelled) setFetchError(err?.message ?? "fetch failed");
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, rec?.mal_id, fullData]);

  const maxVolumes = fullData?.volumes ?? null;

  const handleAdd = async () => {
    if (!rec) return;
    setCommitting(true);
    setCommitError(null);
    try {
      // Build the richest manga payload we can from the MAL fetch. If the
      // fetch failed, fall back to the minimal rec info.
      const info = fullData ?? {};
      const mangaData = {
        mal_id: rec.mal_id,
        title: info.title ?? rec.title,
        volumes: Math.max(info.volumes ?? 0, ownedCount, 1),
        images: info.images ?? {
          jpg: { image_url: rec.image_url, large_image_url: rec.image_url },
        },
        genres: info.genres ?? [],
        explicit_genres: info.explicit_genres ?? [],
        demographics: info.demographics ?? [],
      };

      if (ownedCount <= 0) {
        // Just add the series — no owned volumes
        await addManga.mutateAsync({
          name: mangaData.title,
          mal_id: mangaData.mal_id,
          volumes: mangaData.volumes,
          volumes_owned: 0,
          image_url_jpg:
            mangaData.images?.jpg?.large_image_url ??
            mangaData.images?.jpg?.image_url,
          genres: (mangaData.genres || [])
            .concat(mangaData.explicit_genres || [])
            .concat(mangaData.demographics || [])
            .filter((g) => g.type === "manga")
            .map((g) => g.name),
        });
      } else {
        // Add + mark 1..ownedCount as owned, each at the same price
        const volumeNumbers = Array.from(
          { length: ownedCount },
          (_, i) => i + 1,
        );
        await commitScan({
          manga: mangaData,
          volumeNumbers,
          price: Number(price) || 0,
          priceMode: "all",
        });
      }

      setDone(true);
      onAdded?.({ mal_id: rec.mal_id, ownedCount });
      setTimeout(() => {
        onClose?.();
      }, 900);
    } catch (err) {
      console.error(err);
      setCommitError(err?.message ?? "commit failed");
    } finally {
      setCommitting(false);
    }
  };

  const candidate = fullData
    ? {
        mal_id: fullData.mal_id,
        title: fullData.title,
        title_english: fullData.title_english,
        volumes: fullData.volumes,
        score: fullData.score,
        images: fullData.images,
      }
    : rec
      ? {
          mal_id: rec.mal_id,
          title: rec.title,
          images: { jpg: { image_url: rec.image_url } },
        }
      : null;

  return (
    <Modal
      popupOpen={Boolean(open && rec)}
      handleClose={committing ? undefined : onClose}
    >
      <div className="max-w-md overflow-hidden rounded-2xl border border-border bg-ink-1 shadow-2xl">
        {/* Header — same "source of this suggestion" strip as the scan card */}
        <div className="border-b border-border p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko">
            {t("recs.label")}
          </p>
          <p className="mt-1 text-xs text-washi-muted">
            {t("recs.recommendedBy", { n: rec?.sourceCount ?? 1 })}
          </p>
        </div>

        {/* Cover + title */}
        <div className="flex gap-3 p-4">
          {candidate?.images?.jpg?.image_url ? (
            <img
              src={candidate.images.jpg.image_url}
              alt=""
              className="h-32 w-24 shrink-0 rounded-md border border-border object-cover shadow-lg"
            />
          ) : (
            <div className="h-32 w-24 shrink-0 rounded-md border border-border bg-ink-2 grid place-items-center font-display text-3xl italic text-hanko/40">
              巻
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
              {t("scan.match")}
            </p>
            <h3 className="mt-1 font-display text-lg font-semibold leading-tight text-washi">
              {candidate?.title ?? "…"}
            </h3>
            {candidate?.title_english &&
              candidate.title_english !== candidate.title && (
                <p className="text-xs italic text-washi-muted">
                  {candidate.title_english}
                </p>
              )}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] uppercase tracking-wider text-washi-dim">
              {fetching ? (
                <Skeleton className="h-3 w-16" />
              ) : (
                <>
                  <span>
                    {t("searchResults.vols", {
                      n: candidate?.volumes ?? "?",
                    })}
                  </span>
                  {candidate?.score && (
                    <span className="text-gold">★ {candidate.score}</span>
                  )}
                </>
              )}
            </div>

            {rec?.mal_id && (
              <a
                href={`https://myanimelist.net/manga/${rec.mal_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 rounded-full border border-border bg-ink-0/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-washi-muted transition hover:border-hanko/40 hover:text-washi"
              >
                {t("recs.viewOnMal")}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-2.5 w-2.5"
                >
                  <path d="M7 17 17 7M7 7h10v10" />
                </svg>
              </a>
            )}
          </div>
        </div>

        {/* Volume count input */}
        <div className="border-t border-border p-4">
          <label
            htmlFor="rec-owned"
            className="block font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim"
          >
            {t("recs.ownedLabel")}
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOwnedCount((v) => Math.max(0, v - 1))}
              className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-ink-0/40 text-washi transition hover:border-hanko/40"
              aria-label="-"
            >
              −
            </button>
            <input
              id="rec-owned"
              type="number"
              min={0}
              max={maxVolumes ?? undefined}
              value={ownedCount}
              onChange={(e) => {
                const n = Math.max(0, Number(e.target.value) || 0);
                setOwnedCount(maxVolumes ? Math.min(n, maxVolumes) : n);
              }}
              onFocus={(e) => {
                if (Number(e.target.value) === 0) e.target.select();
              }}
              className="w-full rounded-lg border border-border bg-ink-0 px-3 py-2 text-center font-display text-lg font-semibold text-washi focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
            />
            <button
              type="button"
              onClick={() =>
                setOwnedCount((v) =>
                  maxVolumes ? Math.min(maxVolumes, v + 1) : v + 1,
                )
              }
              className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-ink-0/40 text-washi transition hover:border-hanko/40"
              aria-label="+"
            >
              +
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-washi-dim">
            {ownedCount === 0
              ? t("recs.ownedHintZero")
              : t("recs.ownedHintFilled", {
                  n: ownedCount,
                  max: maxVolumes ?? "?",
                })}
          </p>
        </div>

        {/* Price input — only meaningful if at least one volume owned */}
        {ownedCount > 0 && (
          <div className="border-t border-border p-4">
            <label
              htmlFor="rec-price"
              className="block font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim"
            >
              {t("recs.priceLabel", {
                symbol: currencySetting?.symbol ?? "$",
              })}
            </label>
            <input
              id="rec-price"
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onFocus={(e) => {
                if (Number(e.target.value) === 0) e.target.select();
              }}
              placeholder="0.00"
              className="mt-1.5 w-full rounded-lg border border-border bg-ink-0 px-3 py-2 font-display text-sm font-semibold text-washi focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
            />
            <p className="mt-1.5 text-[10px] text-washi-dim">
              {t("recs.priceHint", { n: ownedCount })}
            </p>
          </div>
        )}

        {/* Error banner */}
        {(fetchError || commitError) && (
          <div className="border-t border-hanko/30 bg-hanko/10 p-3 text-xs text-hanko-bright">
            {commitError ?? fetchError}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 border-t border-border bg-ink-0/40 p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={committing}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-washi-muted transition hover:text-washi disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={committing || done}
            className="flex-1 rounded-lg bg-hanko px-4 py-2 text-sm font-semibold text-washi transition hover:bg-hanko-bright active:scale-95 disabled:opacity-60"
          >
            {committing ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-washi/30 border-t-washi" />
                {ownedCount > 1
                  ? t("scan.addingVolumes", { n: ownedCount })
                  : t("scan.addingSingle")}
              </span>
            ) : done ? (
              t("common.done")
            ) : ownedCount === 0 ? (
              t("recs.addSeries")
            ) : ownedCount === 1 ? (
              t("recs.addSeriesWithOne")
            ) : (
              t("recs.addSeriesWithN", { n: ownedCount })
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
