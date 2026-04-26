import { useMemo } from "react";
import CoverImage from "@/components/ui/CoverImage.jsx";
import { useT } from "@/i18n/index.jsx";

/**
 * 棚 · Shelf-mode tile — appreciation view.
 *
 * Pure presentational sibling of `<Volume>`. Where Volume is the dense
 * accountancy row (price, store, edit pencil, owned-toggle button), this
 * is the "wall of covers" tile: cover image up-front, state implied
 * through opacity / chrome rather than spelled out in metadata.
 *
 * Visual rules:
 *   - **Owned**  → full opacity, gentle warm shadow lifting on hover.
 *   - **Missing** → 35% opacity, grayscale, dashed sakura border.
 *     Reads as "this volume in the series exists, you don't have it
 *     yet" without screaming. The grayscale is the cue.
 *   - **Read**     → small 読 stamp top-left in gold.
 *   - **Collector** → 限 stamp top-right in hanko.
 *   - **Upcoming** → 来 stamp top-right in moegi (replaces 限 if both
 *     are true since collector + upcoming is rare and "upcoming" is
 *     the more time-sensitive cue).
 *   - **Volume number** → mono chip bottom-left for spatial anchoring
 *     when the cover doesn't include a visible volume number.
 *
 * Interaction: this view is intentionally read-only. Editing happens
 * in 帳 (ledger) mode. The user switches modes when they want to
 * accountancy-edit; this surface is for browsing.
 */
export default function VolumeShelfTile({
  volNum,
  owned,
  collector,
  readAt,
  releaseDate = null,
  coverUrl,
  blurImage = false,
  locked = false,
}) {
  const t = useT();

  // 来 · Upcoming = release date in the future (or no release info but
  // marked as not owned and tagged announced — but for the tile, the
  // simplest rule is `releaseDate > now` regardless of owned state).
  const isUpcoming = useMemo(() => {
    if (!releaseDate) return false;
    const ts = new Date(releaseDate).getTime();
    return Number.isFinite(ts) && ts > Date.now();
  }, [releaseDate]);

  const isRead = Boolean(readAt);
  const isCollector = Boolean(collector);

  const altText = t("manga.coverAlt", { n: volNum });

  return (
    <div
      className={`group relative aspect-[2/3] overflow-hidden rounded-md transition will-change-transform ${
        owned
          ? "shadow-[0_2px_8px_rgba(0,0,0,0.35)] hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(0,0,0,0.45)]"
          : "border border-dashed border-sakura/30 bg-ink-1/40 hover:border-sakura/60"
      }`}
      title={
        isUpcoming
          ? t("manga.shelfTitleUpcoming", { n: volNum })
          : owned
            ? t("manga.shelfTitleOwned", { n: volNum })
            : t("manga.shelfTitleMissing", { n: volNum })
      }
    >
      {/* Cover */}
      <div
        className={`absolute inset-0 transition ${
          owned
            ? "opacity-100"
            : "opacity-35 saturate-0 group-hover:opacity-50"
        }`}
      >
        <CoverImage
          src={coverUrl}
          alt={altText}
          blur={blurImage}
          className="h-full w-full object-cover"
          imgClassName="h-full w-full object-cover"
          fallbackKanji="巻"
          fallbackClassName="bg-gradient-to-br from-ink-2 to-ink-1"
        />
      </div>

      {/* Bottom darkening for badge legibility on bright covers */}
      {owned && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-ink-0/80 via-ink-0/30 to-transparent"
        />
      )}

      {/* 読 · Read corner — top-left, gold */}
      {isRead && owned && (
        <span
          aria-label={t("manga.shelfBadgeRead")}
          className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded-sm bg-gold/85 font-jp text-[10px] font-bold leading-none text-ink-0 shadow-sm"
          style={{ transform: "rotate(-6deg)" }}
        >
          読
        </span>
      )}

      {/* 限 / 来 · Top-right corner. Upcoming wins the slot if both. */}
      {isUpcoming ? (
        <span
          aria-label={t("manga.shelfBadgeUpcoming")}
          className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-sm bg-moegi/85 font-jp text-[10px] font-bold leading-none text-ink-0 shadow-sm"
          style={{ transform: "rotate(6deg)" }}
        >
          来
        </span>
      ) : (
        isCollector &&
        owned && (
          <span
            aria-label={t("manga.shelfBadgeCollector")}
            className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-sm bg-hanko/90 font-jp text-[10px] font-bold leading-none text-washi shadow-[0_0_6px_var(--hanko-glow)]"
            style={{ transform: "rotate(6deg)" }}
          >
            限
          </span>
        )
      )}

      {/* 鎖 · Coffret-locked tile — tiny corner mark so users know why
          the tile won't react to ledger edits. Bottom-right, neutral. */}
      {locked && owned && (
        <span
          aria-label={t("manga.shelfBadgeLocked")}
          className="absolute bottom-1 right-1 grid h-4 w-4 place-items-center rounded-sm bg-ink-0/70 font-jp text-[9px] font-bold leading-none text-washi-dim"
        >
          盒
        </span>
      )}

      {/* Volume number chip — bottom-left, monospace, subtle.
          Always present so the user can locate vol-N at a glance even
          if the cover artwork doesn't carry a visible number. */}
      <span className="absolute bottom-1 left-1 rounded-sm bg-ink-0/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-washi backdrop-blur-sm">
        {volNum}
      </span>
    </div>
  );
}
