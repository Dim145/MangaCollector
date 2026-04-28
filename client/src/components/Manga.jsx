import { useNavigate } from "react-router-dom";
import CoverImage from "./ui/CoverImage.jsx";
import { hasToBlurImage } from "@/utils/library.js";
import { useT, useLang } from "@/i18n/index.jsx";

export default function Manga({
  manga,
  adult_content_level,
  allCollector,
  tsundokuCount = 0,
  nextUpcoming,
}) {
  const navigate = useNavigate();
  const t = useT();
  const lang = useLang();

  const owned = manga.volumes_owned ?? 0;
  const total = manga.volumes ?? 0;
  const completion = total > 0 ? Math.min(100, (owned / total) * 100) : 0;
  const blur = hasToBlurImage(manga, adult_content_level);
  const complete = total > 0 && owned >= total;
  // 来 · "Caught up · next volume coming" surfacing.
  //
  // The most useful upcoming-info moment for a reader is the one
  // where they have nothing else to buy in this series — they're
  // up to date AND a fresh tome has been announced. Showing the
  // date as a slim ribbon under the title:
  //   - reuses the moegi tone the rest of the app already maps to
  //     "next / upcoming" (the editor scrapers, the calendar tab,
  //     the refresh-upcoming menu item all use it)
  //   - reuses the 来 kanji the same family carries
  //   - keeps the `complete` badge intact in the top-right (the
  //     achievement is real; the new tome is supplementary info,
  //     not a state change)
  // Series that are still ongoing don't get this ribbon — the
  // user already has volumes to buy first; piling another date on
  // top would just add visual noise to a card that's already in
  // the "in-progress" state.
  const showNextUpcoming = complete && nextUpcoming?.release_date_ms;
  const nextDateLabel = showNextUpcoming
    ? formatNextDate(nextUpcoming.release_date_ms, lang)
    : null;
  // Wishlist (願 · negai) — series the user has tracked but hasn't started
  // owning yet. Distinct from "ongoing" (some volumes acquired) and from
  // "complete". Surfaced with a sakura accent so the user can spot the gap
  // between intent and acquisition at a glance, and so the sort/filter
  // grammar on the dashboard can target it explicitly.
  const wishlist = total > 0 && owned === 0;

  return (
    <button
      onClick={() =>
        navigate("/mangapage", { state: { manga, adult_content_level } })
      }
      // `contain: layout` — the Library grid renders many of these
      // (now also lazy-paginated by 30s). `layout` containment keeps any
      // class change on one card (hover, ownership flip) from rippling
      // layout through the rest of the grid. We deliberately drop the
      // `paint` half because it clips painting to the element's box —
      // the inner cover wrapper translates up by 4px on hover
      // (`group-hover:-translate-y-1`), which pushes the TOP border (and
      // any badge near top:0) outside the contained box and made the
      // top edge of the moegi/hanko hover-border vanish. Same bug class
      // as the Volume.jsx corner-badge clipping fixed earlier.
      className="group relative flex flex-col text-left tap-none focus-visible:outline-none [contain:layout]"
    >
      {/* Cover — tall aspect like a real manga volume */}
      <div
        className={`relative aspect-[2/3] w-full overflow-hidden rounded-lg border bg-ink-2 shadow-lg transition-all duration-500 group-hover:shadow-2xl group-hover:-translate-y-1 ${
          // Idle border tracks the wishlist state — a faint sakura ring on
          // an otherwise default border so the wished-for vs. owned
          // distinction is readable even before hover. Owned/complete
          // inherit the normal border; their accent comes from the badge.
          wishlist
            ? "border-dashed border-sakura/35"
            : "border-border"
        } ${
          allCollector
            ? "group-hover:border-gold/60"
            : complete
              ? "group-hover:border-moegi/60"
              : wishlist
                ? "group-hover:border-sakura/70"
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

        {/* Status badge (top-right) — mutually exclusive ladder.
            COMPLETE : solid moegi pill + ✓.   Achievement state, loud.
            ONGOING  : hanko outline + ◐.      In-flight, neutral mid-tone.
            WISHLIST : sakura outline + 願.    Wanted but no volume yet.
            none     : total === 0 (custom series with unknown total).
            Without the wishlist tier, a 0 / 14 series rendered visually
            identical to a 1 / 14 — the only cue was the bottom counter,
            and that's the easiest spot to overlook. */}
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
        ) : wishlist ? (
          <div
            className="absolute top-2 right-2 flex items-center gap-1 rounded-full border border-sakura/55 bg-ink-0/65 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sakura shadow-[0_1px_3px_rgba(10,9,8,0.4)] opacity-80 backdrop-blur transition group-hover:opacity-100"
            aria-label={t("manga.wishlist")}
          >
            {/* 願 · negai — "wish". The hand-painted brush kanji keeps
                the badge in the same Japanese-typographic family as 限
                (collector) / 積 (tsundoku) / 完 (complete) while reading
                instantly as "wanted, not yet acquired". */}
            <span
              className="font-jp text-[11px] font-bold leading-none"
              aria-hidden="true"
            >
              願
            </span>
            {t("manga.wishlist")}
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
          {/* 来 · Next-volume ribbon. Kanji-led, tabular-nums for the
              date so the digits don't jitter between cards in the
              grid. `border-t` of moegi/15 anchors it to the title
              above without needing a heavier separator; the kanji
              itself does the visual lifting. Hidden on the densest
              breakpoint (grid-cols-6) where a 3rd row of metadata
              would push the title into truncation — but the dot
              indicator stays via `sm:block` on the inner span so
              the user still has a hint something's coming. */}
          {showNextUpcoming && (
            <div
              className="mt-1.5 flex items-center gap-1.5 border-t border-moegi/15 pt-1 text-moegi"
              title={t("manga.nextVolumeHint", { date: nextDateLabel })}
            >
              <span
                aria-hidden="true"
                className="font-jp text-[11px] font-bold leading-none drop-shadow-md"
              >
                来
              </span>
              <span className="truncate font-mono text-[10px] font-semibold uppercase tracking-wider tabular-nums drop-shadow-md">
                {nextDateLabel}
              </span>
            </div>
          )}
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-washi-muted">
              {/* Counter colour matches the state ladder: sakura when the
                  shelf is still empty (wishlist), hanko otherwise. Keeps
                  "0" from reading as a danger-red signal on the wishlist
                  state — the rose tone is closer to "wanted" than "wrong". */}
              <span className={wishlist ? "text-sakura" : "text-hanko-bright"}>
                {owned}
              </span>
              <span className="text-washi-dim"> / {total || "?"}</span>
            </span>
            <span className="text-[10px] font-medium text-washi-dim">
              {t("manga.volumesShort")}
            </span>
          </div>

          {/* 進 · Progress bar — three flavours:
              · complete : full moegi gradient
              · wishlist : a faint sakura outline at full width, dashed
                           via background-image, signalling intent without
                           pretending progress
              · ongoing  : hanko gradient at the actual completion %. */}
          {total > 0 && (
            <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-washi/15">
              {wishlist ? (
                <div
                  className="h-full w-full opacity-50"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(90deg, var(--sakura) 0 4px, transparent 4px 8px)",
                  }}
                  aria-hidden="true"
                />
              ) : (
                <div
                  className={`h-full transition-all duration-500 ${
                    complete
                      ? "bg-gradient-to-r from-moegi to-moegi-muted"
                      : "bg-gradient-to-r from-hanko to-hanko-bright"
                  }`}
                  style={{ width: `${completion}%` }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

/**
 * 日付 · Compact next-release date formatter for the dashboard
 * card. Sized to fit a ~10ch slot under the title across the
 * grid breakpoints (2 → 6 columns).
 *
 * Logic:
 *   - Same calendar year as `now`  → `"7 mai"` (FR) / `"May 7"` (EN)
 *     / `"7 may."` (ES). The year is implicit, the day-month is
 *     the actionable bit.
 *   - Different year → tack on a 2-digit year ("7 mai 27") so the
 *     reader doesn't think a 14-month-out announcement is "next
 *     week."
 *   - Past dates collapse silently to `null` — the caller has
 *     already filtered to future-only, but the guard means a
 *     stale row in the cache can't surface a misleading "due
 *     yesterday" badge.
 *
 * Locale resolution falls through `Intl.DateTimeFormat`'s native
 * matching: passing `"fr"` yields the French short-month form,
 * which the project's existing `useLang` hook already provides.
 */
function formatNextDate(ms, lang) {
  if (typeof ms !== "number" || Number.isNaN(ms)) return null;
  const target = new Date(ms);
  const now = new Date();
  if (target.getTime() <= now.getTime()) return null;
  const sameYear = target.getFullYear() === now.getFullYear();
  const opts = sameYear
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "2-digit" };
  // Browser fallback — Safari < 14 / very old Firefox could
  // throw on a malformed lang code. Use English short-form as
  // the safety net rather than blowing up the whole card render.
  try {
    return new Intl.DateTimeFormat(lang || "en", opts).format(target);
  } catch {
    return new Intl.DateTimeFormat("en", opts).format(target);
  }
}
