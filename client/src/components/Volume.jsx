import { useEffect, useState } from "react";
import Tooltip from "./ui/Tooltip.jsx";
import VolumeDetailDrawer from "./VolumeDetailDrawer.jsx";
import { useUpdateVolume } from "@/hooks/useVolumes.js";
import { useCoverPreviewGesture } from "@/hooks/useCoverPreviewGesture.js";
import { formatCurrency } from "@/utils/price.js";
import { useT } from "@/i18n/index.jsx";

/**
 * Volume card.
 *
 * When `locked=true` (the volume belongs to a coffret), every write-path is
 * disabled: no ownership toggle, no inline edit form, the pencil is hidden.
 * The coffret header above is the single source of truth for that volume's
 * owned / price / store / collector state — editing them inline would create
 * a split-brain with the coffret totals.
 */
export default function Volume({
  id,
  mal_id,
  owned,
  volNum,
  paid,
  store,
  collector,
  // Reading status — ISO timestamp string if read, null otherwise.
  // Orthogonal to ownership: a volume can be read without being owned
  // (borrowed / library copy) and owned without being read (classic
  // tsundoku 積読 — the pile of acquired-but-unread books).
  readAt,
  // 来 · Upcoming-volume metadata. A row whose `releaseDate` is in the
  // future is announced-but-not-yet-shipped — visual treatment is
  // distinct (moegi tier + kanji 来) and every "I have this" axis is
  // hard-disabled at the UI layer (server enforces too). When the
  // date passes, all four fields stay set but the predicate flips
  // and the row falls back to the regular missing/owned visual
  // grammar — no migration needed.
  releaseDate = null,
  releaseIsbn = null,
  releaseUrl = null,
  origin = "manual",
  announcedAt = null,
  locked = false,
  onUpdate,
  currencySetting,
  // Optional per-volume cover URL (from MangaDex via the useVolumeCovers
  // hook). When present, the click-target badge is replaced by the actual
  // book cover with a small number chip pinned to the corner.
  coverUrl,
  blurImage = false,
  // Preview gesture callbacks — forwarded from MangaPage's shared
  // controller. Volume itself doesn't own the preview state anymore; that
  // lives upstream so keyboard nav across siblings works.
  onPreviewShow,
  onPreviewRelease,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [ownedStatus, setOwnedStatus] = useState(owned);
  const [price, setPrice] = useState(Number(paid) || 0);
  const [purchaseLocation, setPurchaseLocation] = useState(store ?? "");
  const [collectorStatus, setCollectorStatus] = useState(Boolean(collector));
  const [readStatus, setReadStatus] = useState(Boolean(readAt));

  const updateVolume = useUpdateVolume();
  const isLoading = updateVolume.isPending;
  const t = useT();

  // Hover (desktop) + long-press (touch) → notifies the shared preview
  // controller (lives in MangaPage). Disabled when the adult filter is
  // active (blurImage=true for level 0 or 1) — users who've asked to
  // blur / hide adult content shouldn't be able to peek around the
  // filter via the preview. The thumbnail itself stays blurred as-is;
  // only the "zoom on hover/long-press" interaction is neutralised.
  const preview = useCoverPreviewGesture({
    enabled: Boolean(coverUrl) && !isEditing && !blurImage,
    onShow: (rect, sticky) => onPreviewShow?.(volNum, rect, sticky),
    onRelease: () => onPreviewRelease?.(),
  });

  async function persist(
    nextOwned,
    nextPrice,
    nextStore,
    nextCollector,
    ownedChanged,
    nextRead,
  ) {
    // `nextRead === undefined` → leave read_at untouched (used when
    // only owned / price / store / collector change). When set, we send
    // a boolean that the server maps to a timestamp (or null).
    await updateVolume.mutateAsync({
      id,
      mal_id,
      vol_num: volNum,
      owned: nextOwned,
      price: Number(nextPrice) || 0,
      store: nextStore ?? "",
      collector: Boolean(nextCollector),
      ...(nextRead !== undefined ? { read: Boolean(nextRead) } : {}),
    });
    onUpdate?.({ ownedChanged });
  }

  const toggleOwned = async () => {
    if (isEditing || locked) return;
    // 来 · An upcoming volume cannot be owned — server enforces this
    // too, but blocking the gesture client-side avoids the round-trip
    // + WS event for nothing. The drawer-tap path below is the
    // legitimate way for the user to interact (read-only details).
    if (isUpcoming) {
      // Long-press preview is suppressed alongside the tap so a
      // suppressed click doesn't bounce the consumeClick latch into
      // an unexpected state on a future tap.
      preview.consumeClick();
      return;
    }
    // Suppress the tap when a long-press just opened the preview — the
    // user wanted to peek, not to flip the ownership.
    if (preview.consumeClick()) return;
    const next = !ownedStatus;
    setOwnedStatus(next);
    await persist(next, price, purchaseLocation, collectorStatus, true);
  };

  const toggleRead = async () => {
    if (isEditing) return;
    // 来 · An upcoming volume cannot be marked read either —
    // physically impossible until it ships. Blocking client-side
    // matches the server enforce in `services::volume::update_by_id`.
    if (isUpcoming) return;
    // Reading is orthogonal to the coffret lock — a box set controls
    // ownership/price/collector state for its members, but it does NOT
    // control whether you've read them. We let locked volumes flip their
    // read status freely, and just make sure we don't clobber the
    // coffret-owned fields (owned/price/store/collector) on persist.
    const next = !readStatus;
    setReadStatus(next);
    // Auto-own on mark-read — but only for non-locked volumes. Locked
    // volumes already have owned=true from their coffret (you can't box
    // unowned volumes), so the branch below rarely fires anyway; guarding
    // on `!locked` makes the intent explicit and prevents any future
    // regression where a locked volume's `owned` state gets clobbered.
    let nextOwned = ownedStatus;
    let ownedChanged = false;
    if (!locked && next && !ownedStatus) {
      nextOwned = true;
      setOwnedStatus(true);
      ownedChanged = true;
    }
    await persist(
      nextOwned,
      price,
      purchaseLocation,
      collectorStatus,
      ownedChanged,
      next,
    );
  };

  const handleSave = async () => {
    setIsEditing(false);
    const ownedChanged = ownedStatus !== owned;
    const readChanged = readStatus !== Boolean(readAt);
    await persist(
      ownedStatus,
      price,
      purchaseLocation,
      collectorStatus,
      ownedChanged,
      readChanged ? readStatus : undefined,
    );
  };

  const handleCancel = () => {
    setIsEditing(false);
    setOwnedStatus(owned);
    setPrice(Number(paid) || 0);
    setPurchaseLocation(store ?? "");
    setCollectorStatus(Boolean(collector));
    setReadStatus(Boolean(readAt));
  };

  // Seed local state from server props, BUT only when the user isn't
  // actively editing. Without this guard, a realtime-sync push (WS
  // broadcast from another device, or the outbox flush echoing back
  // the same row after a partial save) would overwrite the fields
  // the user is currently typing into — their half-filled price or
  // store gets reset to the previous saved value mid-edit.
  //
  // Note: when the user exits editing (either via save or cancel),
  // the reset in `resetEditState` (called from the cancel path) or
  // the successful `persist` (which already mutates local state
  // optimistically) lines things back up with the incoming props on
  // the NEXT render.
  useEffect(() => {
    if (isEditing) return;
    setOwnedStatus(owned);
    setPrice(Number(paid) || 0);
    setPurchaseLocation(store ?? "");
    setCollectorStatus(Boolean(collector));
    setReadStatus(Boolean(readAt));
  }, [owned, paid, store, collector, readAt, isEditing]);

  // If a volume becomes locked while the edit form is open (e.g. the user
  // adds it to a coffret from elsewhere), collapse the form automatically.
  useEffect(() => {
    if (locked && isEditing) setIsEditing(false);
  }, [locked, isEditing]);

  // 来 · Compute "is this an announced-but-not-yet-released volume?"
  // The predicate is recomputed on every render so when the clock
  // ticks past the release date, the visual grammar flips
  // automatically — no async transition, no stale state.
  const releaseDateObj = releaseDate ? new Date(releaseDate) : null;
  const isUpcoming = Boolean(
    releaseDateObj &&
      !Number.isNaN(releaseDateObj.getTime()) &&
      releaseDateObj.getTime() > Date.now(),
  );
  const daysUntilRelease = isUpcoming
    ? Math.max(
        0,
        Math.ceil(
          (releaseDateObj.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
        ),
      )
    : null;
  // 旬 · Imminent = within 7 days. Switches the badge tone from
  // moegi (calm anticipation) to sakura (here-it-comes), and the
  // pulse animation engages so peripheral vision catches it.
  const isImminent = isUpcoming && daysUntilRelease <= 7;

  // Card shell — collector adds a gold ring + subtle gold glow, stacking on
  // top of whatever the ownership state dictates. Upcoming gets its own
  // dedicated treatment (dotted moegi border + gradient), distinct from
  // the missing tier so the user sees a row that "isn't real yet".
  const borderClasses = isUpcoming
    ? isImminent
      ? "border-sakura/55 bg-gradient-to-br from-sakura/10 via-ink-1/40 to-ink-1/40 shadow-[0_0_18px_rgba(245,194,210,0.18)]"
      : "border-moegi/40 bg-gradient-to-br from-moegi/8 via-ink-1/40 to-ink-1/40"
    : collectorStatus
      ? "border-transparent ring-2 ring-gold/80 shadow-[0_0_22px_rgba(201,169,97,0.25)]"
      : ownedStatus
        ? "border-hanko/40 bg-hanko/5 hover:border-hanko/60"
        : "border-border bg-ink-1/40 hover:border-border/80";

  // Volume-number badge colors: gold-inverted when collector, hanko when
  // merely owned, neutral otherwise. Upcoming overrides everything because
  // an announced tome can be neither owned nor collector — it's a fourth
  // state in its own right.
  const badgeClasses = isUpcoming
    ? isImminent
      ? "border-sakura bg-gradient-to-br from-sakura to-sakura/70 text-ink-0 shadow-md"
      : "border-moegi bg-gradient-to-br from-moegi to-moegi-muted text-ink-0 shadow-md"
    : collectorStatus
      ? "border-gold bg-gradient-to-br from-gold to-gold-muted text-ink-0 shadow-md"
      : ownedStatus
        ? "border-hanko bg-hanko text-washi shadow-md glow-red"
        : "border-border bg-ink-2 text-washi-dim hover:border-hanko/40 hover:text-washi";

  return (
    <div
      className={`group relative rounded-xl border transition-all duration-300 ${collectorStatus ? "bg-gradient-to-br from-gold/5 via-ink-1/40 to-ink-1/40" : ""} ${borderClasses}`}
    >
      {/* Collector hanko seal — pinned like a wax seal at the card's top-right corner.
          Wrapped in <Tooltip> for a reliable CSS-only hover label; the native
          `title` attribute was unreliable on this absolutely-positioned
          decorative span in certain browser/layout combos.
          Suppressed when the volume is upcoming — collector is a state
          that only applies to a tome you actually own. */}
      {collectorStatus && !isUpcoming && (
        <span className="absolute -right-2 -top-2 z-20">
          <Tooltip text={t("volume.collectorTitle")} placement="top">
            <span
              aria-label={t("volume.collectorTitle")}
              className="grid h-5 w-5 place-items-center rounded-full bg-gradient-to-br from-gold to-gold-muted text-ink-0 shadow-[0_2px_12px_rgba(201,169,97,0.6)] ring-1 ring-gold/80"
              style={{ transform: "rotate(-8deg)" }}
            >
              <span className="font-display text-[10px] font-bold leading-none">
                限
              </span>
            </span>
          </Tooltip>
        </span>
      )}

      {/* 来 · Upcoming-volume seal. Pinned where the collector seal
          lives (they're mutually exclusive — server enforces). Tone
          shifts from moegi (calm "anticipated") to sakura ("imminent")
          inside a 7-day window so peripheral vision catches it.
          The kanji 来 (rai = "to come / next") doubles as a state
          marker AND a pictogram — even readers unfamiliar with
          kanji learn its meaning by association after seeing it
          paired with the date overlay below. */}
      {isUpcoming && (
        <span className="absolute -right-2 -top-2 z-20">
          <Tooltip
            text={t("volume.upcomingTooltip", {
              date: formatReleaseDate(releaseDate),
            })}
            placement="top"
          >
            <span
              aria-label={t("volume.upcomingTooltip", {
                date: formatReleaseDate(releaseDate),
              })}
              className={`grid h-5 w-5 place-items-center rounded-full text-ink-0 ring-1 ${
                isImminent
                  ? "bg-gradient-to-br from-sakura to-sakura/70 ring-sakura/80 shadow-[0_2px_12px_rgba(245,194,210,0.55)] animate-pulse-glow"
                  : "bg-gradient-to-br from-moegi to-moegi-muted ring-moegi/70 shadow-[0_2px_12px_rgba(163,201,97,0.45)]"
              }`}
              style={{ transform: "rotate(-8deg)" }}
            >
              <span className="font-jp text-[10px] font-bold leading-none">
                来
              </span>
            </span>
          </Tooltip>
        </span>
      )}

      {/* (The tsundoku seal was removed here — the inline 読/未 toggle
          below makes it redundant, and the two together visually
          doubled-up on the same card corner.) */}

      <div className="flex items-center gap-3 p-4">
        {coverUrl ? (
          /* Cover-mode click target — a tall 2:3 thumbnail that stands in
             for the number badge. Ownership state is carried by ring color
             (gold collector > hanko owned > border missing) + dimming
             overlay when not owned. A small number chip is pinned to the
             bottom-right, like a library sticker on a physical volume. */
          <button
            onClick={toggleOwned}
            disabled={isEditing || isLoading || locked || isUpcoming}
            aria-label={
              isUpcoming
                ? t("volume.upcomingAria", {
                    date: formatReleaseDate(releaseDate),
                  })
                : locked
                  ? t("volume.lockedAria")
                  : ownedStatus
                    ? t("volume.markNotOwned")
                    : t("volume.markOwned")
            }
            title={
              isUpcoming
                ? t("volume.upcomingTooltip", {
                    date: formatReleaseDate(releaseDate),
                  })
                : locked
                  ? t("volume.lockedTitle")
                  : undefined
            }
            // Gesture handlers for the floating preview. They spread across
            // the same button that handles the tap-to-toggle, which is fine
            // because the hook coordinates the two (long-press suppresses
            // the subsequent click via consumeClick()).
            {...preview.handlers}
            // data-vol-num lets the shared preview controller re-anchor on
            // the correct DOM node when the user navigates with ← / →.
            data-vol-num={volNum}
            // touch-action: avoid the browser treating the long-press as a
            // text selection or callout; we take ownership of the gesture.
            style={{ touchAction: "manipulation" }}
            className={`group/vol relative h-14 w-10 flex-shrink-0 overflow-hidden rounded-md border shadow-md transition-all duration-300 ${
              isUpcoming
                ? isImminent
                  ? "border-sakura/70 ring-1 ring-sakura/50 shadow-[0_0_12px_rgba(245,194,210,0.35)]"
                  : "border-moegi/70 ring-1 ring-moegi/40 shadow-[0_0_12px_rgba(163,201,97,0.30)]"
                : collectorStatus
                  ? "border-gold ring-1 ring-gold/60 shadow-[0_0_12px_rgba(201,169,97,0.35)]"
                  : ownedStatus
                    ? "border-hanko/70 shadow-[0_0_10px_rgba(220,38,38,0.2)]"
                    : "border-border"
            } ${
              locked || isUpcoming ? "cursor-default" : "hover:-translate-y-0.5"
            } ${isEditing ? "opacity-60" : ""}`}
          >
            <img referrerPolicy="no-referrer"
              src={coverUrl}
              alt=""
              loading="lazy"
              draggable={false}
              className={`h-full w-full select-none object-cover transition-transform duration-500 ${
                isUpcoming ? "" : "group-hover/vol:scale-105"
              } ${blurImage ? "blur-md" : ""} ${
                isUpcoming
                  ? "brightness-50 saturate-50"
                  : !ownedStatus && !locked
                    ? "brightness-40 grayscale"
                    : ""
              }`}
            />

            {/* 来 · Upcoming-state overlay. Stronger than the missing
                wash because the cover is metadata for an unreleased
                tome, not a missing-from-collection one. The countdown
                text sits on top in font-mono so the date stays
                readable even when the source artwork is busy. */}
            {isUpcoming && (
              <>
                <span className="pointer-events-none absolute inset-0 bg-ink-0/65" />
                <span className="pointer-events-none absolute inset-0 grid place-items-center">
                  <span
                    className={`font-mono text-[8px] font-bold uppercase leading-none tracking-[0.15em] ${
                      isImminent ? "text-sakura" : "text-moegi"
                    }`}
                    style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
                  >
                    J−{daysUntilRelease}
                  </span>
                </span>
              </>
            )}

            {/* Missing-state overlay — tinted wash that evokes "not yet
                in the collection" without fully hiding the cover.
                Suppressed when upcoming because that state has its
                own overlay above. */}
            {!ownedStatus && !locked && !isUpcoming && (
              <span className="pointer-events-none absolute inset-0 bg-ink-0/55" />
            )}

            {/* Loading spinner while saving */}
            {isLoading && (
              <span className="pointer-events-none absolute inset-0 grid place-items-center bg-ink-0/70">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-washi/40 border-t-washi" />
              </span>
            )}

            {/* Volume number chip — bottom-right corner. Color tracks the
                ownership state so it's readable even when the cover art
                is bright/dark/busy. */}
            <span
              className={`pointer-events-none absolute bottom-0.5 right-0.5 grid min-h-4 min-w-4 place-items-center rounded-sm px-1 font-mono text-[9px] font-bold leading-none shadow ${
                isUpcoming
                  ? isImminent
                    ? "bg-sakura text-ink-0"
                    : "bg-moegi text-ink-0"
                  : collectorStatus
                    ? "bg-gradient-to-br from-gold to-gold-muted text-ink-0"
                    : ownedStatus
                      ? "bg-hanko text-washi"
                      : "bg-ink-0/85 text-washi ring-1 ring-washi/10"
              }`}
            >
              {volNum}
            </span>
          </button>
        ) : (
          /* Legacy number-badge click target — used when no cover URL is
             available (series without a MangaDex match, or volume not
             published on MangaDex yet). */
          <button
            onClick={toggleOwned}
            disabled={isEditing || isLoading || locked || isUpcoming}
            aria-label={
              isUpcoming
                ? t("volume.upcomingAria", {
                    date: formatReleaseDate(releaseDate),
                  })
                : locked
                  ? t("volume.lockedAria")
                  : ownedStatus
                    ? t("volume.markNotOwned")
                    : t("volume.markOwned")
            }
            title={
              isUpcoming
                ? t("volume.upcomingTooltip", {
                    date: formatReleaseDate(releaseDate),
                  })
                : locked
                  ? t("volume.lockedTitle")
                  : undefined
            }
            className={`relative grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg border font-mono text-xs font-bold transition ${badgeClasses} ${
              locked || isUpcoming ? "cursor-default" : ""
            }`}
          >
            {isLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <>
                <span className="text-[10px] font-semibold uppercase tracking-wider">
                  {t("manga.volumesShort")}
                </span>
                <span className="absolute -bottom-0.5 right-0.5 text-[9px]">
                  {volNum}
                </span>
              </>
            )}
          </button>
        )}

        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2 font-display text-base font-semibold leading-none text-washi">
            <span>{t("volume.volume", { n: volNum })}</span>
            {collectorStatus && (
              <span className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-gold">
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-2.5 w-2.5"
                  aria-hidden="true"
                >
                  <path d="M12 2l2.5 6.5L21 9l-5 4.8L17.5 21 12 17.5 6.5 21l1.5-7.2L3 9l6.5-.5L12 2z" />
                </svg>
                {t("volume.collectorBadge")}
              </span>
            )}
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            {isUpcoming ? (
              /* 来 · Upcoming-state label, replaces the owned/missing
                 row when the volume isn't out yet. The countdown pill
                 sits where the price normally lives — same horizontal
                 rhythm so the layout doesn't jump as a tome
                 transitions from upcoming to released. */
              <>
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${
                    isImminent ? "text-sakura" : "text-moegi"
                  }`}
                >
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-2.5 w-2.5 self-center"
                    aria-hidden="true"
                  >
                    {/* Hourglass-ish glyph: announced, not yet here. */}
                    <path d="M3 2h10M3 14h10M5 2v3.5l3 2.5 3-2.5V2M5 14v-3.5l3-2.5 3 2.5V14" />
                  </svg>
                  {t("volume.upcomingLabel")}
                </span>
                <span
                  className={`font-mono text-xs ${
                    isImminent ? "text-sakura" : "text-washi-muted"
                  }`}
                >
                  {formatReleaseDate(releaseDate)} · J−{daysUntilRelease}
                </span>
              </>
            ) : (
              <>
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${
                    ownedStatus ? "text-gold" : "text-washi-dim"
                  }`}
                >
                  {/* Non-colour state glyph — gives the row a second cue beyond
                      the gold/dim tint, so colour-blind users can read state at
                      a glance. ✓ for owned, ○ for missing. Inline SVG keeps the
                      baseline aligned with the label. */}
                  {ownedStatus ? (
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-2.5 w-2.5 self-center"
                      aria-hidden="true"
                    >
                      <polyline points="3 8.5 7 12 13 4.5" />
                    </svg>
                  ) : (
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      className="h-2.5 w-2.5 self-center"
                      aria-hidden="true"
                    >
                      <circle cx="8" cy="8" r="5.5" />
                    </svg>
                  )}
                  {ownedStatus ? t("volume.inCollection") : t("volume.missing")}
                </span>
                {ownedStatus && price > 0 && (
                  <span className="font-mono text-xs text-washi-muted">
                    {formatCurrency(price, currencySetting)}
                  </span>
                )}
              </>
            )}
            {locked && (
              <span className="group/lock relative inline-flex items-center">
                <span
                  tabIndex={0}
                  role="img"
                  aria-label={t("volume.lockedAria")}
                  aria-describedby={`lock-tip-${id}`}
                  className="inline-flex cursor-help items-center text-washi-dim transition-colors hover:text-washi focus-visible:text-washi focus:outline-none"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3 w-3"
                    aria-hidden="true"
                  >
                    <rect x="4" y="11" width="16" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                </span>
                {/* Fade-in tooltip — appears above the padlock on hover or
                    keyboard focus. Kept pointer-events-none so it never eats
                    clicks on what's below. */}
                <span
                  id={`lock-tip-${id}`}
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[15rem] -translate-x-1/2 rounded-md border border-border bg-ink-2/95 px-2.5 py-1.5 text-[11px] leading-snug text-washi opacity-0 shadow-xl backdrop-blur-sm transition-opacity duration-200 after:absolute after:left-1/2 after:top-full after:-translate-x-1/2 after:border-[5px] after:border-transparent after:border-t-ink-2 group-hover/lock:opacity-100 group-focus-within/lock:opacity-100"
                >
                  {t("volume.lockedTitle")}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Quick read toggle — an inline 読/未 pill that flips the reading
            status without opening the full editor. Moegi-jade when read,
            muted ink when unread. Placed just before the edit pencil so
            the most common toggle is reachable with a single tap.
            Stays available on locked (coffret) volumes because reading
            is independent of the box-set-managed ownership axes. On a
            locked volume we surface the read date in `title` since the
            full editor (where the date normally lives) is unreachable.
            Suppressed on upcoming volumes — there's nothing to read
            yet. */}
        {!isEditing && !isUpcoming && (
          <button
            onClick={toggleRead}
            aria-label={readStatus ? t("volume.markUnread") : t("volume.markRead")}
            aria-pressed={readStatus}
            title={
              readStatus
                ? readAt
                  ? t("volume.readTitle", {
                      date: formatReadDate(readAt),
                    })
                  : t("volume.markUnread")
                : t("volume.markRead")
            }
            className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border font-jp text-[13px] font-bold transition ${
              readStatus
                ? "border-moegi/60 bg-moegi/15 text-moegi shadow-[0_0_10px_rgba(163,201,97,0.2)] hover:bg-moegi/25"
                : "border-transparent text-washi-dim hover:border-border hover:bg-washi/5 hover:text-washi"
            }`}
          >
            {readStatus ? "読" : "未"}
          </button>
        )}

        {/* 来 · Upcoming-volume info chip. Replaces the read pill +
            pencil on an unreleased tome — opens the read-only drawer
            so the user can see ISBN / publisher / pre-order URL
            without being able to flip ownership. Tap target stays at
            8×8 to preserve the row's rhythm. */}
        {isUpcoming && !isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            aria-label={t("volume.upcomingDetailsAria")}
            title={t("volume.upcomingDetailsTitle")}
            className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border transition ${
              isImminent
                ? "border-sakura/60 bg-sakura/10 text-sakura hover:bg-sakura/20"
                : "border-moegi/50 bg-moegi/5 text-moegi hover:bg-moegi/15"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              {/* Info-circle: read-only details signal. */}
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="8" x2="12" y2="8" />
              <line x1="12" y1="12" x2="12" y2="16" />
            </svg>
          </button>
        )}

        {/* Edit pencil — hidden when the volume is managed by a coffret
            OR when the volume is upcoming (the info-circle above takes
            its slot in that case, and a real edit on an unreleased
            tome would be rejected by the server anyway). */}
        {!locked && !isEditing && !isUpcoming ? (
          <button
            onClick={() => setIsEditing(true)}
            aria-label={t("common.edit")}
            className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-washi-dim transition hover:bg-washi/5 hover:text-washi"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* Edit drawer — slides in from the right edge over the live grid.
          Replaces the previous in-card inline expansion (which forced a
          reflow of every sibling card every time a user opened a single
          edit form). The drawer is a "controlled" component — all form
          state still lives here on Volume, so cancel can reset cleanly
          and an in-flight save survives a brief drawer remount.
          We pass `isEditing && !locked` rather than gating the JSX on
          !locked: a volume turning into a coffret member mid-edit (the
          useEffect above flips isEditing→false too) then plays the
          slide-out animation instead of unmounting instantly. */}
      <VolumeDetailDrawer
        open={isEditing && !locked}
        onClose={handleCancel}
        id={id}
        volNum={volNum}
        coverUrl={coverUrl}
        blurImage={blurImage}
        readAt={readAt}
        currencySetting={currencySetting}
        ownedStatus={ownedStatus}
        setOwnedStatus={setOwnedStatus}
        readStatus={readStatus}
        setReadStatus={setReadStatus}
        collectorStatus={collectorStatus}
        setCollectorStatus={setCollectorStatus}
        price={price}
        setPrice={setPrice}
        purchaseLocation={purchaseLocation}
        setPurchaseLocation={setPurchaseLocation}
        isLoading={isLoading}
        onSave={handleSave}
        onCancel={handleCancel}
        // 来 · Upcoming-volume metadata. The drawer reads these to
        // toggle into a read-only "details" mode where save is
        // hidden and the form fields are disabled.
        isUpcoming={isUpcoming}
        releaseDate={releaseDate}
        releaseIsbn={releaseIsbn}
        releaseUrl={releaseUrl}
        origin={origin}
        announcedAt={announcedAt}
        daysUntilRelease={daysUntilRelease}
      />

      {!isEditing && ownedStatus && purchaseLocation && (
        <div className="flex items-center gap-1.5 border-t border-border/50 px-4 py-2 text-[11px] text-washi-muted">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3 text-washi-dim"
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
          </svg>
          <span className="truncate">{purchaseLocation}</span>
        </div>
      )}
    </div>
  );
}

/** Format an ISO read_at timestamp for UI captions — short locale-aware
 *  rendering (e.g. "14 mars 2026"). Returns an empty string on bad input. */
function formatReadDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

/** Format an ISO release_date for upcoming-volume captions. Identical
 *  rendering to `formatReadDate` today, kept as a separate symbol so
 *  Phase 3 can plug a richer formatter (locale-aware "in 3 weeks" /
 *  "next month") without bleeding into the read-history caption. */
function formatReleaseDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}
