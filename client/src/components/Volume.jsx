import { useEffect, useState } from "react";
import StoreAutocomplete from "./ui/StoreAutocomplete.jsx";
import Tooltip from "./ui/Tooltip.jsx";
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
    // Suppress the tap when a long-press just opened the preview — the
    // user wanted to peek, not to flip the ownership.
    if (preview.consumeClick()) return;
    const next = !ownedStatus;
    setOwnedStatus(next);
    await persist(next, price, purchaseLocation, collectorStatus, true);
  };

  const toggleRead = async () => {
    if (isEditing) return;
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

  useEffect(() => {
    setOwnedStatus(owned);
    setPrice(Number(paid) || 0);
    setPurchaseLocation(store ?? "");
    setCollectorStatus(Boolean(collector));
    setReadStatus(Boolean(readAt));
  }, [owned, paid, store, collector, readAt]);

  // If a volume becomes locked while the edit form is open (e.g. the user
  // adds it to a coffret from elsewhere), collapse the form automatically.
  useEffect(() => {
    if (locked && isEditing) setIsEditing(false);
  }, [locked, isEditing]);

  // Card shell — collector adds a gold ring + subtle gold glow, stacking on
  // top of whatever the ownership state dictates.
  const borderClasses = collectorStatus
    ? "border-transparent ring-2 ring-gold/80 shadow-[0_0_22px_rgba(201,169,97,0.25)]"
    : ownedStatus
      ? "border-hanko/40 bg-hanko/5 hover:border-hanko/60"
      : "border-border bg-ink-1/40 hover:border-border/80";

  // Volume-number badge colors: gold-inverted when collector, hanko when
  // merely owned, neutral otherwise.
  const badgeClasses = collectorStatus
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
          decorative span in certain browser/layout combos. */}
      {collectorStatus && (
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
            disabled={isEditing || isLoading || locked}
            aria-label={
              locked
                ? t("volume.lockedAria")
                : ownedStatus
                  ? t("volume.markNotOwned")
                  : t("volume.markOwned")
            }
            title={locked ? t("volume.lockedTitle") : undefined}
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
              collectorStatus
                ? "border-gold ring-1 ring-gold/60 shadow-[0_0_12px_rgba(201,169,97,0.35)]"
                : ownedStatus
                  ? "border-hanko/70 shadow-[0_0_10px_rgba(220,38,38,0.2)]"
                  : "border-border"
            } ${locked ? "cursor-not-allowed" : "hover:-translate-y-0.5"} ${isEditing ? "opacity-60" : ""}`}
          >
            <img
              src={coverUrl}
              alt=""
              loading="lazy"
              draggable={false}
              className={`h-full w-full select-none object-cover transition-transform duration-500 group-hover/vol:scale-105 ${
                blurImage ? "blur-md" : ""
              } ${!ownedStatus && !locked ? "brightness-40 grayscale" : ""}`}
            />

            {/* Missing-state overlay — tinted wash that evokes "not yet
                in the collection" without fully hiding the cover. */}
            {!ownedStatus && !locked && (
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
                collectorStatus
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
            disabled={isEditing || isLoading || locked}
            aria-label={
              locked
                ? t("volume.lockedAria")
                : ownedStatus
                  ? t("volume.markNotOwned")
                  : t("volume.markOwned")
            }
            title={locked ? t("volume.lockedTitle") : undefined}
            className={`relative grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg border font-mono text-xs font-bold transition ${badgeClasses} ${locked ? "cursor-not-allowed" : ""}`}
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
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider ${
                ownedStatus ? "text-gold" : "text-washi-dim"
              }`}
            >
              {ownedStatus ? t("volume.inCollection") : t("volume.missing")}
            </span>
            {ownedStatus && price > 0 && (
              <span className="font-mono text-xs text-washi-muted">
                {formatCurrency(price, currencySetting)}
              </span>
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
            full editor (where the date normally lives) is unreachable. */}
        {!isEditing && (
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

        {/* Edit pencil — hidden when the volume is managed by a coffret */}
        {!locked && !isEditing ? (
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

      {isEditing && !locked && (
        <div className="space-y-3 border-t border-border bg-ink-0/40 p-4 animate-fade-up">
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim">
              {t("volume.statusLabel")}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: true, label: t("volume.ownedOption") },
                { v: false, label: t("volume.missingOption") },
              ].map((opt) => (
                <button
                  key={String(opt.v)}
                  onClick={() => setOwnedStatus(opt.v)}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wider transition ${
                    ownedStatus === opt.v
                      ? opt.v
                        ? "border-hanko bg-hanko text-washi"
                        : "border-border bg-ink-2 text-washi"
                      : "border-border bg-transparent text-washi-dim hover:text-washi"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reading toggle — the tsundoku axis. Paired with collector
              below so the two orthogonal states (edition type + read
              status) live side by side in the editor, visually. */}
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim">
              {t("volume.readingLabel")}
            </label>
            <button
              type="button"
              onClick={() => setReadStatus((r) => !r)}
              aria-pressed={readStatus}
              className={`group flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                readStatus
                  ? "border-moegi/60 bg-gradient-to-br from-moegi/10 to-transparent"
                  : "border-border bg-ink-1 hover:border-moegi/40"
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full font-jp text-[12px] font-bold leading-none transition ${
                    readStatus
                      ? "bg-gradient-to-br from-moegi to-moegi-muted text-ink-0 shadow-[0_0_10px_rgba(163,201,97,0.4)]"
                      : "bg-ink-2 text-washi-dim"
                  }`}
                  style={readStatus ? { transform: "rotate(5deg)" } : undefined}
                >
                  {readStatus ? "読" : "未"}
                </span>
                <span>
                  <span
                    className={`block text-sm font-semibold ${
                      readStatus ? "text-moegi" : "text-washi"
                    }`}
                  >
                    {readStatus
                      ? t("volume.readOption")
                      : t("volume.unreadOption")}
                  </span>
                  <span className="block text-[11px] text-washi-muted">
                    {readStatus && readAt
                      ? t("volume.readSince", {
                          date: formatReadDate(readAt),
                        })
                      : t("volume.readingHint")}
                  </span>
                </span>
              </span>
              <span
                className={`relative h-6 w-11 rounded-full border transition ${
                  readStatus
                    ? "border-moegi bg-moegi/90"
                    : "border-border bg-ink-2"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                    readStatus
                      ? "right-0.5 bg-ink-0 shadow-md"
                      : "left-0.5 bg-washi-dim"
                  }`}
                />
              </span>
            </button>
          </div>

          {/* Collector toggle — a distinct gold-accented switch so users
              associate it with the "rare / limited" visual language. */}
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim">
              {t("volume.editionLabel")}
            </label>
            <button
              type="button"
              onClick={() => setCollectorStatus((c) => !c)}
              aria-pressed={collectorStatus}
              className={`group flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                collectorStatus
                  ? "border-gold/70 bg-gradient-to-br from-gold/10 to-transparent"
                  : "border-border bg-ink-1 hover:border-gold/40"
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold transition ${
                    collectorStatus
                      ? "bg-gradient-to-br from-gold to-gold-muted text-ink-0 shadow-[0_0_10px_rgba(201,169,97,0.5)]"
                      : "bg-ink-2 text-washi-dim"
                  }`}
                  style={
                    collectorStatus ? { transform: "rotate(-6deg)" } : undefined
                  }
                  title={t("badges.collector")}
                >
                  限
                </span>
                <span>
                  <span className={`block text-sm font-semibold ${collectorStatus ? "text-gold" : "text-washi"}`}>
                    {t("volume.collectorOption")}
                  </span>
                  <span className="block text-[11px] text-washi-muted">
                    {t("volume.collectorHint")}
                  </span>
                </span>
              </span>
              <span
                className={`relative h-6 w-11 rounded-full border transition ${
                  collectorStatus
                    ? "border-gold bg-gold/90"
                    : "border-border bg-ink-2"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                    collectorStatus
                      ? "right-0.5 bg-ink-0 shadow-md"
                      : "left-0.5 bg-washi-dim"
                  }`}
                />
              </span>
            </button>
          </div>

          <div>
            <label
              htmlFor={`price-${id}`}
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim"
            >
              {t("volume.priceLabel", {
                symbol: currencySetting?.symbol || "$",
              })}
            </label>
            <input
              id={`price-${id}`}
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onFocus={(e) => {
                if (Number(e.target.value) === 0) e.target.select();
              }}
              placeholder="0"
              step="0.01"
              min="0"
              className="w-full rounded-lg border border-border bg-ink-1 px-3 py-2 text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
            />
          </div>

          <div>
            <label
              htmlFor={`store-${id}`}
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim"
            >
              {t("volume.storeLabel")}
            </label>
            <StoreAutocomplete
              id={`store-${id}`}
              value={purchaseLocation ?? ""}
              onChange={(e) => setPurchaseLocation(e.target.value)}
              placeholder={t("volume.storePlaceholder")}
              className="w-full rounded-lg border border-border bg-ink-1 px-3 py-2 text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={isLoading}
              className="flex-1 rounded-lg bg-hanko px-3 py-2 text-xs font-semibold uppercase tracking-wider text-washi transition hover:bg-hanko-bright active:scale-95 disabled:opacity-60"
            >
              {isLoading ? t("common.saving") : t("common.save")}
            </button>
            <button
              onClick={handleCancel}
              disabled={isLoading}
              className="flex-1 rounded-lg border border-border bg-transparent px-3 py-2 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi hover:border-border/80"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

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
