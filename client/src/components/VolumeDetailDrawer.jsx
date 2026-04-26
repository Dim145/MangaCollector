import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import StoreAutocomplete from "./ui/StoreAutocomplete.jsx";
import { useT } from "@/i18n/index.jsx";
import { formatCurrency } from "@/utils/price.js";

/**
 * Volume detail drawer — slides in from the right edge so the underlying
 * volume grid stays visible behind a translucent ink scrim. This replaces
 * the previous in-card inline expansion which forced the rest of the grid
 * to reflow every time the user opened a single edit form.
 *
 * Design language is Shōjo Noir: 巻 (kan/maki = "volume / scroll") sits as
 * a faint hanko watermark behind the form, the panel is gradient-inked,
 * the save action carries the hanko-red, and the close affordance is a
 * round corner button mirroring <Modal>'s.
 *
 * State is *controlled* — the parent (`Volume`) owns the form fields. The
 * drawer is intentionally dumb beyond chrome (mount/unmount, focus trap,
 * scroll lock, ESC) so that:
 *   - cancel can reset state back to the server-side props,
 *   - save can persist + close in one atomic flow,
 *   - the optimistic-but-not-yet-flushed values survive a brief drawer
 *     re-render while a mutation is in flight.
 */

/** Must match `animate-drawer-out` duration so the unmount fires AFTER the
 *  exit animation finishes, not on top of it. */
const CLOSE_ANIM_MS = 240;

// Reference-counted body-scroll lock — same pattern as <Modal>. Multiple
// drawers stacking would be unusual but it's cheap to be safe, and it
// also means a Modal opening over a Drawer (or vice-versa) won't fight
// over the original overflow value.
let activeDrawerCount = 0;
let savedBodyOverflow = null;
function acquireScrollLock() {
  if (activeDrawerCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  activeDrawerCount += 1;
}
function releaseScrollLock() {
  activeDrawerCount = Math.max(0, activeDrawerCount - 1);
  if (activeDrawerCount === 0) {
    document.body.style.overflow = savedBodyOverflow ?? "";
    savedBodyOverflow = null;
  }
}

/** Format an ISO read_at timestamp for UI captions. Mirrors the helper
 *  in Volume.jsx but kept inline so this component can stand alone. */
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

export default function VolumeDetailDrawer({
  open,
  onClose,
  // ── Volume context (display-only) ─────────────────────────────────────
  id,
  volNum,
  coverUrl,
  blurImage = false,
  readAt,
  currencySetting,
  // ── Form state — controlled by the parent ─────────────────────────────
  ownedStatus,
  setOwnedStatus,
  readStatus,
  setReadStatus,
  collectorStatus,
  setCollectorStatus,
  price,
  setPrice,
  purchaseLocation,
  setPurchaseLocation,
  // ── Lifecycle ─────────────────────────────────────────────────────────
  isLoading,
  onSave,
  onCancel,
}) {
  const t = useT();

  // Decouple DOM lifecycle from `open` so we can play the slide-out
  // animation BEFORE unmounting, just like <Modal>.
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const closeTimer = useRef(null);

  useEffect(() => {
    if (open) {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    closeTimer.current = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
      closeTimer.current = null;
    }, CLOSE_ANIM_MS);
    return () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Refs for focus management. The panel is what we trap inside; the
  // overlay is just the click-outside catcher.
  const overlayRef = useRef(null);
  const panelRef = useRef(null);
  const lastFocusedBeforeOpenRef = useRef(null);

  // Mirror onClose into a ref — see <Modal>.jsx for the rationale: an
  // inline-arrow callback would re-bind the keyup listener on every parent
  // render, which can drop a keystroke during the one-frame gap.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!mounted) return;

    const handleKeyUp = (e) => {
      if (e.key === "Escape") {
        const close = onCloseRef.current;
        if (typeof close === "function") close();
      }
    };

    // Focus trap — same selector as <Modal>. Tab cycles among interactive
    // descendants of the panel; Shift+Tab cycles backwards. We don't trap
    // arrow keys because the form has buttons + inputs that legitimately
    // benefit from native arrow-key behaviour (e.g. the number input
    // increment).
    const handleKeyDown = (e) => {
      if (e.key !== "Tab") return;
      const root = panelRef.current;
      if (!root) return;
      const selector =
        'a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';
      const tabbables = root.querySelectorAll(selector);
      if (!tabbables.length) {
        e.preventDefault();
        return;
      }
      const first = tabbables[0];
      const last = tabbables[tabbables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    lastFocusedBeforeOpenRef.current = document.activeElement;

    acquireScrollLock();
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("keydown", handleKeyDown);

    // Push focus inside the drawer once it's painted. Falls back to the
    // panel itself (tabIndex=-1 below) if no `data-autofocus` is present.
    requestAnimationFrame(() => {
      const root = panelRef.current;
      if (!root) return;
      const preferred = root.querySelector("[data-autofocus]");
      if (preferred && typeof preferred.focus === "function") {
        preferred.focus();
      } else if (typeof root.focus === "function") {
        root.focus();
      }
    });

    return () => {
      releaseScrollLock();
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("keydown", handleKeyDown);
      const opener = lastFocusedBeforeOpenRef.current;
      if (
        opener &&
        typeof opener.focus === "function" &&
        document.contains(opener)
      ) {
        try {
          opener.focus();
        } catch {
          /* opener detached — ignore */
        }
      }
      lastFocusedBeforeOpenRef.current = null;
    };
    // Effect deps intentionally narrow: handlers come off refs (so they
    // can't be stale even though they aren't listed), and the only state
    // we actually want to react to is the mount transition.
  }, [mounted]);

  if (!mounted) return null;
  if (typeof document === "undefined") return null;

  const overlayAnim = leaving ? "animate-fade-out" : "animate-fade-in";
  const panelAnim = leaving ? "animate-drawer-out" : "animate-drawer-in";

  const overlay = (
    <div
      ref={overlayRef}
      className={`fixed inset-0 flex items-stretch justify-end bg-ink-0/70 backdrop-blur-[3px] ${overlayAnim}`}
      // Highest sane z-index — escape any transformed/isolate ancestor.
      // Portaled to <body> so DefaultBackground can't trap us anyway.
      style={{ zIndex: 2147483630 }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        // Backdrop tap behaves like Cancel: discard local edits, close.
        // (We deliberately don't let it auto-save — that'd surprise users
        // who tapped outside expecting the inline-form's previous "click
        // anywhere to dismiss" behaviour, where state was reset.)
        onCancel?.();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("volume.editDrawerTitle", { n: volNum })}
        tabIndex={-1}
        className={`relative flex h-full w-full max-w-[26rem] flex-col overflow-hidden border-l border-border bg-gradient-to-b from-ink-1 via-ink-1 to-ink-0 shadow-[0_0_60px_-12px_rgba(220,38,38,0.35)] focus:outline-none ${panelAnim}`}
      >
        {/* Background watermark — 巻 (kan/maki = "volume / scroll").
            Sits behind everything at very low opacity, like a hanko mark
            stamped onto handmade paper. Pointer-events disabled so it
            never eats clicks. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -right-12 top-24 select-none font-jp text-[28rem] font-bold leading-none text-hanko/[0.04]"
          style={{ writingMode: "vertical-rl" }}
        >
          巻
        </span>

        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="relative z-10 flex items-start justify-between gap-3 border-b border-border bg-ink-1/85 p-5 backdrop-blur">
          <div className="flex items-start gap-4">
            {coverUrl ? (
              <span
                className={`relative h-24 w-16 flex-shrink-0 overflow-hidden rounded-md border shadow-md transition ${
                  collectorStatus
                    ? "border-gold ring-1 ring-gold/60 shadow-[0_0_12px_rgba(201,169,97,0.35)]"
                    : ownedStatus
                      ? "border-hanko/70 shadow-[0_0_10px_rgba(220,38,38,0.2)]"
                      : "border-border"
                }`}
              >
                <img
                  referrerPolicy="no-referrer"
                  src={coverUrl}
                  alt=""
                  draggable={false}
                  className={`h-full w-full select-none object-cover ${
                    blurImage ? "blur-md" : ""
                  } ${!ownedStatus ? "brightness-50 grayscale" : ""}`}
                />
                {!ownedStatus && (
                  <span className="pointer-events-none absolute inset-0 bg-ink-0/55" />
                )}
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
              </span>
            ) : (
              <span
                className={`grid h-24 w-16 flex-shrink-0 place-items-center rounded-md border bg-ink-2 font-mono text-base font-bold ${
                  collectorStatus
                    ? "border-gold text-gold"
                    : ownedStatus
                      ? "border-hanko text-hanko"
                      : "border-border text-washi-dim"
                }`}
              >
                {volNum}
              </span>
            )}
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-hanko">
                {t("volume.editDrawerEyebrow")}
              </p>
              <h2 className="mt-1.5 font-display text-xl font-semibold italic leading-tight text-washi">
                {t("volume.volume", { n: volNum })}
              </h2>
              <p className="mt-1 text-[12px] leading-snug text-washi-muted">
                {t("volume.editDrawerLead")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("common.close")}
            className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full border border-border bg-ink-2/80 text-washi-dim transition hover:border-hanko hover:bg-hanko hover:text-washi"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Form (scrollable middle) ──────────────────────────────── */}
        <div className="relative z-10 flex-1 space-y-5 overflow-y-auto p-5">
          {/* Status (owned / missing) */}
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim">
              {t("volume.statusLabel")}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: true, label: t("volume.ownedOption") },
                { v: false, label: t("volume.missingOption") },
              ].map((opt, idx) => (
                <button
                  key={String(opt.v)}
                  type="button"
                  onClick={() => setOwnedStatus(opt.v)}
                  // First Owned button gets autofocus so keyboard users
                  // land on a meaningful control, not the close button.
                  data-autofocus={idx === 0 ? true : undefined}
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

          {/* Reading toggle (tsundoku axis) */}
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
                  style={
                    readStatus ? { transform: "rotate(5deg)" } : undefined
                  }
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

          {/* Collector toggle (gold-accented edition switch) */}
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
                    collectorStatus
                      ? { transform: "rotate(-6deg)" }
                      : undefined
                  }
                  title={t("badges.collector")}
                >
                  限
                </span>
                <span>
                  <span
                    className={`block text-sm font-semibold ${
                      collectorStatus ? "text-gold" : "text-washi"
                    }`}
                  >
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

          {/* Price */}
          <div>
            <label
              htmlFor={`drawer-price-${id}`}
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim"
            >
              {t("volume.priceLabel", {
                symbol: currencySetting?.symbol || "$",
              })}
            </label>
            <input
              id={`drawer-price-${id}`}
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
            {ownedStatus && Number(price) > 0 && (
              <p className="mt-1.5 font-mono text-[11px] text-washi-muted">
                {formatCurrency(Number(price), currencySetting)}
              </p>
            )}
          </div>

          {/* Store / location */}
          <div>
            <label
              htmlFor={`drawer-store-${id}`}
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim"
            >
              {t("volume.storeLabel")}
            </label>
            <StoreAutocomplete
              id={`drawer-store-${id}`}
              value={purchaseLocation ?? ""}
              onChange={(e) => setPurchaseLocation(e.target.value)}
              placeholder={t("volume.storePlaceholder")}
              className="w-full rounded-lg border border-border bg-ink-1 px-3 py-2 text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
            />
          </div>
        </div>

        {/* ── Footer (sticky save / cancel) ─────────────────────────── */}
        <div className="relative z-10 mt-auto flex gap-2 border-t border-border bg-ink-1/95 p-4 backdrop-blur">
          <button
            type="button"
            onClick={onSave}
            disabled={isLoading}
            className="flex-1 rounded-lg bg-hanko px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-washi transition hover:bg-hanko-bright active:scale-95 disabled:opacity-60"
          >
            {isLoading ? t("common.saving") : t("common.save")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 rounded-lg border border-border bg-transparent px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:border-border/80 hover:text-washi"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
