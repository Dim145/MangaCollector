import { memo, useEffect, useRef, useState } from "react";
import Tooltip from "./ui/Tooltip.jsx";
import VolumeDetailDrawer from "./VolumeDetailDrawer.jsx";
import { useUpdateVolume } from "@/hooks/useVolumes.js";
import { useCoverPreviewGesture } from "@/hooks/useCoverPreviewGesture.js";
import { formatCurrency } from "@/utils/price.js";
import { formatShortDate } from "@/utils/volume.js";
import { haptics } from "@/lib/haptics.js";
import { sounds } from "@/lib/sounds.js";
import { useT } from "@/i18n/index.jsx";

/**
 * Volume card. When `locked=true` (volume belongs to a coffret) every write-path
 * is disabled — the coffret header is the single source of truth for owned /
 * price / store / collector to avoid split-brain with the coffret totals.
 */
function VolumeImpl({
  id,
  mal_id,
  owned,
  volNum,
  paid,
  store,
  collector,
  readAt,
  note = null,
  releaseDate = null,
  releaseIsbn = null,
  releaseUrl = null,
  origin = "manual",
  announcedAt = null,
  locked = false,
  onUpdate,
  // 来 · Optional callback fired when the user requests "edit announce"
  // from the drawer's upcoming-mode footer. Receives the volume's current
  // announce-side fields so the parent can hydrate the modal.
  onEditUpcoming,
  currencySetting,
  coverUrl,
  blurImage = false,
  onPreviewShow,
  onPreviewRelease,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [ownedStatus, setOwnedStatus] = useState(owned);
  const [price, setPrice] = useState(Number(paid) || 0);
  const [purchaseLocation, setPurchaseLocation] = useState(store ?? "");
  const [collectorStatus, setCollectorStatus] = useState(Boolean(collector));
  const [readStatus, setReadStatus] = useState(Boolean(readAt));
  const [noteDraft, setNoteDraft] = useState(note ?? "");

  // 確 · Confirmation feedback for Volume toggleOwned.
  //   - tickKey: monotonic counter that increments on each owned-flip
  //     to TRUE. Mounted as the `<span key={tickKey}>` of the tick
  //     overlay so the CSS keyframe replays from frame 0 every time
  //     (a same-key element wouldn't re-trigger its animation).
  //   - tickRevision: tracks which key was *applied* — tick visible
  //     only when current. Auto-clears 800ms later (matches keyframe
  //     length) so the unmounted element stops occupying the layer.
  //   - coverButtonRef: imperative target for the WAAPI bump on flip,
  //     fired in either direction. Imperative-only because re-firing
  //     a CSS animation on the same element requires class toggle +
  //     reflow gymnastics; .animate() restarts cleanly every call.
  const [tickKey, setTickKey] = useState(0);
  const [tickVisible, setTickVisible] = useState(false);
  const coverButtonRef = useRef(null);

  function playOwnedFeedback(toOwned) {
    coverButtonRef.current?.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.08)" },
        { transform: "scale(1)" },
      ],
      { duration: 240, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
    );
    if (toOwned) {
      setTickKey((k) => k + 1);
      setTickVisible(true);
      setTimeout(() => setTickVisible(false), 800);
    }
  }

  const updateVolume = useUpdateVolume();
  const isLoading = updateVolume.isPending;
  const t = useT();

  // Preview disabled when blurImage is on so the filter can't be peeked around.
  // 滑 · Swipe-to-toggle is gated on the same conditions as the click toggle
  // (not editing, not locked, not upcoming) so a swipe on a coffret-locked
  // tile no-ops cleanly instead of issuing a write the server would reject.
  const preview = useCoverPreviewGesture({
    enabled: Boolean(coverUrl) && !isEditing && !blurImage,
    onShow: (rect, sticky) => onPreviewShow?.(volNum, rect, sticky),
    onRelease: () => onPreviewRelease?.(),
    onSwipeCommit: (direction) => {
      if (isEditing || locked || isUpcoming) return;
      const next = direction === "right";
      // Skip the round-trip when the swipe matches the current state.
      if (next === ownedStatus) return;
      commitOwned(next);
    },
  });

  // `nextRead`/`nextNote === undefined` → leave that field untouched on save.
  async function persist(
    nextOwned,
    nextPrice,
    nextStore,
    nextCollector,
    ownedChanged,
    nextRead,
    nextNote,
  ) {
    await updateVolume.mutateAsync({
      id,
      mal_id,
      vol_num: volNum,
      owned: nextOwned,
      price: Number(nextPrice) || 0,
      store: nextStore ?? "",
      collector: Boolean(nextCollector),
      ...(nextRead !== undefined ? { read: Boolean(nextRead) } : {}),
      ...(nextNote !== undefined ? { notes: String(nextNote) } : {}),
    });
    onUpdate?.({ ownedChanged });
  }

  // 確 · Owned-flip pipeline shared by the click toggle and the swipe
  // commit. Runs the optimistic flip + feedback (haptic, sound, bump,
  // tick) and fires the network write. Caller is responsible for any
  // pre-flight gating (locked, upcoming, no-op-on-equal).
  async function commitOwned(next) {
    setOwnedStatus(next);
    // Same frame as the colour shift so the feedback lands with the
    // click/swipe, not 200 ms later when the network resolves.
    next ? haptics.bump() : haptics.tap();
    next ? sounds.bump() : sounds.tap();
    playOwnedFeedback(next);
    await persist(next, price, purchaseLocation, collectorStatus, true);
  }

  const toggleOwned = async () => {
    if (isEditing || locked) return;
    if (isUpcoming) {
      preview.consumeClick();
      return;
    }
    // Suppress the tap when a long-press opened the preview OR a swipe
    // just committed (both set `suppressClickRef` inside the gesture
    // hook so the post-release click doesn't double-fire).
    if (preview.consumeClick()) return;
    await commitOwned(!ownedStatus);
  };

  const toggleRead = async () => {
    if (isEditing) return;
    if (isUpcoming) return;
    // Reading is orthogonal to the coffret lock — locked volumes can flip
    // read status freely; the persist below preserves the coffret-owned axes.
    const next = !readStatus;
    setReadStatus(next);
    haptics.tap();
    sounds.tap();
    // Auto-own on mark-read, but never on a locked (coffret) volume.
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
    // Only write note when it actually changed — avoids touching modified_on.
    const savedNote = note ?? "";
    const draftNote = noteDraft ?? "";
    const noteChanged = draftNote.trim() !== savedNote.trim();
    await persist(
      ownedStatus,
      price,
      purchaseLocation,
      collectorStatus,
      ownedChanged,
      readChanged ? readStatus : undefined,
      noteChanged ? draftNote : undefined,
    );
  };

  const handleCancel = () => {
    setIsEditing(false);
    setOwnedStatus(owned);
    setPrice(Number(paid) || 0);
    setPurchaseLocation(store ?? "");
    setCollectorStatus(Boolean(collector));
    setReadStatus(Boolean(readAt));
    setNoteDraft(note ?? "");
  };

  // Seed local state from props ONLY when not editing — protects mid-edit
  // typing from being clobbered by realtime-sync echoes / outbox flushes.
  useEffect(() => {
    if (isEditing) return;
    setOwnedStatus(owned);
    setPrice(Number(paid) || 0);
    setPurchaseLocation(store ?? "");
    setCollectorStatus(Boolean(collector));
    setReadStatus(Boolean(readAt));
    setNoteDraft(note ?? "");
  }, [owned, paid, store, collector, readAt, note, isEditing]);

  useEffect(() => {
    if (locked && isEditing) setIsEditing(false);
  }, [locked, isEditing]);

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
  // Imminent = within 7 days → badge flips moegi → sakura + pulse engages.
  const isImminent = isUpcoming && daysUntilRelease <= 7;

  const borderClasses = isUpcoming
    ? isImminent
      ? "border-sakura/55 bg-gradient-to-br from-sakura/10 via-ink-1/40 to-ink-1/40 shadow-[0_0_18px_rgba(245,194,210,0.18)]"
      : "border-moegi/40 bg-gradient-to-br from-moegi/8 via-ink-1/40 to-ink-1/40"
    : collectorStatus
      ? "border-transparent ring-2 ring-gold/80 shadow-[0_0_22px_rgba(201,169,97,0.25)]"
      : ownedStatus
        ? "border-hanko/40 bg-hanko/5 hover:border-hanko/60"
        : "border-border bg-ink-1/40 hover:border-border/80";

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
      // [contain:layout] isolates each card so a sibling re-render
      // can't trigger a reflow rippling through the bucket. We
      // intentionally DON'T add `paint` containment — that would clip
      // the corner seals (限 / 来 / 余) which sit at -right-2 / -top-2
      // / -left-2 and rely on overflowing the card's border-box.
      className={`group relative rounded-xl border transition-all duration-300 [contain:layout] ${collectorStatus ? "bg-gradient-to-br from-gold/5 via-ink-1/40 to-ink-1/40" : ""} ${borderClasses}`}
    >
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

      {isUpcoming && (
        <span className="absolute -right-2 -top-2 z-20">
          <Tooltip
            text={t("volume.upcomingTooltip", {
              date: formatShortDate(releaseDate),
            })}
            placement="top"
          >
            <span
              aria-label={t("volume.upcomingTooltip", {
                date: formatShortDate(releaseDate),
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

      <div className="flex items-center gap-3 p-4">
        {coverUrl ? (
          <button
            ref={coverButtonRef}
            onClick={toggleOwned}
            disabled={isEditing || isLoading || locked || isUpcoming}
            aria-label={
              isUpcoming
                ? t("volume.upcomingAria", {
                    date: formatShortDate(releaseDate),
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
                    date: formatShortDate(releaseDate),
                  })
                : locked
                  ? t("volume.lockedTitle")
                  : undefined
            }
            {...preview.handlers}
            // data-vol-num lets the shared preview controller re-anchor on ← / →.
            data-vol-num={volNum}
            // 滑 · Swipe-to-toggle visual: damp the raw delta with a cube
            // root so the cover follows the finger 1:1 near zero but
            // resists past ~50 px (rubber-band feel). Only the X is
            // moved; rotation hints at direction without making the
            // tile spin. `touchAction: "pan-y"` lets vertical scroll
            // pass through while horizontal stays captured by us.
            style={(() => {
              const dx = preview.swipeDx;
              if (!dx) {
                return {
                  touchAction: "manipulation",
                  transform: undefined,
                };
              }
              const damped = Math.sign(dx) * 18 * Math.cbrt(Math.abs(dx) / 18);
              return {
                touchAction: "pan-y",
                transform: `translateX(${damped}px) rotate(${damped * 0.06}deg)`,
                transition: "none",
              };
            })()}
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

            {!ownedStatus && !locked && !isUpcoming && (
              <span className="pointer-events-none absolute inset-0 bg-ink-0/55" />
            )}

            {isLoading && (
              <span className="pointer-events-none absolute inset-0 grid place-items-center bg-ink-0/70">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-washi/40 border-t-washi" />
              </span>
            )}

            {/* 滑 · Swipe direction hint — a colour wash that brightens
                as the gesture approaches the commit threshold. Right
                swipe (toOwned) leans moegi/green; left swipe (toUnowned)
                leans hanko/red. The opacity tracks `|dx| / threshold`
                clamped at 1, so the user gets a "ramp-up to commit"
                signal instead of a binary on/off. */}
            {preview.swipeDx !== 0 && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    preview.swipeDx > 0
                      ? "linear-gradient(90deg, transparent 30%, rgba(163,201,97,0.8))"
                      : "linear-gradient(270deg, transparent 30%, rgba(220,38,38,0.7))",
                  opacity: Math.min(
                    1,
                    Math.abs(preview.swipeDx) / preview.swipeCommitThresholdPx,
                  ),
                  transition: "none",
                }}
              />
            )}

            {/* 確 · Confirmation tick — pops over the cover for ~800ms
                each time the user marks the volume as owned. Keyed on
                tickKey so a rapid toggle (own → unown → own) replays
                the animation from frame 0 instead of skipping. */}
            {tickVisible && (
              <span
                key={tickKey}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 grid place-items-center"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-hanko/95 text-washi shadow-[0_2px_12px_rgba(220,38,38,0.55)] ring-1 ring-hanko-bright animate-volume-tick">
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5"
                  >
                    <polyline points="3 8.5 7 12 13 4.5" />
                  </svg>
                </span>
              </span>
            )}

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
          <button
            ref={coverButtonRef}
            onClick={toggleOwned}
            disabled={isEditing || isLoading || locked || isUpcoming}
            aria-label={
              isUpcoming
                ? t("volume.upcomingAria", {
                    date: formatShortDate(releaseDate),
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
                    date: formatShortDate(releaseDate),
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
                    <path d="M3 2h10M3 14h10M5 2v3.5l3 2.5 3-2.5V2M5 14v-3.5l3-2.5 3 2.5V14" />
                  </svg>
                  {t("volume.upcomingLabel")}
                </span>
                <span
                  className={`font-mono text-xs ${
                    isImminent ? "text-sakura" : "text-washi-muted"
                  }`}
                >
                  {formatShortDate(releaseDate)} · J−{daysUntilRelease}
                </span>
              </>
            ) : (
              <>
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${
                    ownedStatus ? "text-gold" : "text-washi-dim"
                  }`}
                >
                  {/* Glyph (✓/○) doubles the colour cue for colour-blind users. */}
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

        {!isEditing && !isUpcoming && (
          <button
            onClick={toggleRead}
            aria-label={readStatus ? t("volume.markUnread") : t("volume.markRead")}
            aria-pressed={readStatus}
            title={
              readStatus
                ? readAt
                  ? t("volume.readTitle", {
                      date: formatShortDate(readAt),
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
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="8" x2="12" y2="8" />
              <line x1="12" y1="12" x2="12" y2="16" />
            </svg>
          </button>
        )}

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
        note={noteDraft}
        setNote={setNoteDraft}
        isLoading={isLoading}
        onSave={handleSave}
        onCancel={handleCancel}
        isUpcoming={isUpcoming}
        releaseDate={releaseDate}
        releaseIsbn={releaseIsbn}
        releaseUrl={releaseUrl}
        origin={origin}
        announcedAt={announcedAt}
        daysUntilRelease={daysUntilRelease}
        onEditUpcoming={
          onEditUpcoming
            ? () => {
                // Hand the parent a snapshot of the announce fields so it
                // can hydrate the modal without re-querying. We close the
                // drawer first so the modal isn't stacked on top of it.
                handleCancel();
                onEditUpcoming({
                  id,
                  vol_num: volNum,
                  release_date: releaseDate,
                  release_isbn: releaseIsbn,
                  release_url: releaseUrl,
                });
              }
            : undefined
        }
        // After a successful delete the row vanishes from Dexie → the
        // live query updates → the drawer's parent re-renders without
        // this Volume. The drawer just needs to close itself first.
        onAfterDelete={handleCancel}
      />

      {!isEditing &&
        (ownedStatus && purchaseLocation || (note && note.trim())) && (
          <div className="flex items-center gap-1.5 border-t border-border/50 px-4 py-2 text-[11px] text-washi-muted">
            {ownedStatus && purchaseLocation && (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3 w-3 shrink-0 text-washi-dim"
                >
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                </svg>
                <span className="truncate">{purchaseLocation}</span>
              </>
            )}

            {note && note.trim() && (
              <Tooltip
                text={t("volume.noteIndicatorTooltip")}
                placement="top"
              >
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  disabled={locked}
                  aria-label={t("volume.noteIndicatorAria")}
                  className={`ml-auto inline-flex items-center gap-1 rounded-full border border-hanko/20 bg-hanko/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-hanko-bright/80 transition hover:border-hanko/45 hover:bg-hanko/10 hover:text-hanko-bright ${
                    locked ? "cursor-default opacity-60 hover:bg-hanko/5" : ""
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="font-jp text-[11px] font-bold leading-none"
                    style={{ transform: "rotate(-3deg)" }}
                  >
                    記
                  </span>
                  {t("volume.noteIndicatorChip")}
                </button>
              </Tooltip>
            )}
          </div>
        )}
    </div>
  );
}

// memo: callbacks/currencySetting need stable refs from the parent for skipping
// to actually fire — worst case it's a no-op shallow-equal, never a regression.
export default memo(VolumeImpl);
