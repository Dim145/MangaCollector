import { memo, useMemo } from "react";
import CoverImage from "@/components/ui/CoverImage.jsx";
import { useT } from "@/i18n/index.jsx";

function VolumeShelfTileImpl({
  volNum,
  owned,
  collector,
  readAt,
  releaseDate = null,
  coverUrl,
  blurImage = false,
  locked = false,
  note = null,
}) {
  const t = useT();

  const isUpcoming = useMemo(() => {
    if (!releaseDate) return false;
    const ts = new Date(releaseDate).getTime();
    return Number.isFinite(ts) && ts > Date.now();
  }, [releaseDate]);

  const isRead = Boolean(readAt);
  const isCollector = Boolean(collector);
  const hasNote = Boolean(note && String(note).trim());

  const altText = t("manga.coverAlt", { n: volNum });

  return (
    <div
      className={`group relative aspect-[2/3] overflow-hidden rounded-md transition will-change-transform [contain:layout_paint] ${
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

      {owned && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-ink-0/80 via-ink-0/30 to-transparent"
        />
      )}

      {isRead && owned && (
        <span
          aria-label={t("manga.shelfBadgeRead")}
          className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded-sm bg-gold/85 font-jp text-[10px] font-bold leading-none text-ink-0 shadow-sm"
          style={{ transform: "rotate(-6deg)" }}
        >
          読
        </span>
      )}

      {/* Upcoming takes precedence over collector when a tile is both. */}
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

      {/* Locked + note glyphs share the bottom-right corner; offset
          the lock so they sit side-by-side instead of stacked. */}
      {locked && owned && (
        <span
          aria-label={t("manga.shelfBadgeLocked")}
          className={`absolute bottom-1 grid h-4 w-4 place-items-center rounded-sm bg-ink-0/70 font-jp text-[9px] font-bold leading-none text-washi-dim ${
            hasNote ? "right-6" : "right-1"
          }`}
        >
          盒
        </span>
      )}

      {hasNote && (
        <span
          aria-label={t("manga.shelfBadgeNote")}
          title={t("manga.shelfBadgeNote")}
          className="absolute bottom-1 right-1 grid h-4 w-4 place-items-center rounded-sm bg-moegi/85 font-jp text-[9px] font-bold leading-none text-ink-0 shadow-sm"
          style={{ transform: "rotate(4deg)" }}
        >
          記
        </span>
      )}

      <span className="absolute bottom-1 left-1 rounded-sm bg-ink-0/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-washi backdrop-blur-sm">
        {volNum}
      </span>
    </div>
  );
}

export default memo(VolumeShelfTileImpl);
