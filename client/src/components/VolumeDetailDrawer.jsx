import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import StoreAutocomplete from "./ui/StoreAutocomplete.jsx";
import { useT } from "@/i18n/index.jsx";
import { formatCurrency } from "@/utils/price.js";
import { formatShortDate } from "@/utils/volume.js";
import { useDeleteUpcomingVolume } from "@/hooks/useVolumes.js";
import { useFocusTrap } from "@/hooks/useFocusTrap.js";
import { notifySyncError, notifySyncInfo } from "@/lib/sync.js";

/**
 * Volume detail drawer — controlled by the parent (Volume). The drawer is
 * intentionally dumb beyond chrome (mount/unmount, focus trap, scroll lock,
 * ESC) so cancel can reset cleanly and an in-flight save survives a remount.
 */

// Must match the `animate-drawer-out` CSS duration.
const CLOSE_ANIM_MS = 240;

// Body-scroll lock is shared with Modal via `lib/scrollLock.js` —
// otherwise a Modal opening over a Drawer (or vice-versa) leaks an
// `overflow: hidden` after both close, blocking the page until reload.

export default function VolumeDetailDrawer({
  open,
  onClose,
  // Volume row id — needed to wire the upcoming-manual edit/delete CTAs.
  // Optional because some legacy callers don't pass it; the manual
  // controls below only render when both `id` and `origin === "manual"`.
  id,
  volNum,
  coverUrl,
  blurImage = false,
  readAt,
  currencySetting,
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
  note = "",
  setNote = () => {},
  isLoading,
  onSave,
  onCancel,
  isUpcoming = false,
  releaseDate = null,
  releaseIsbn = null,
  releaseUrl = null,
  origin = "manual",
  announcedAt = null,
  daysUntilRelease = null,
  // 来 · "Edit announce" callback — only meaningful when origin = manual.
  // The drawer shows an Edit CTA in the upcoming panel that fires this.
  onEditUpcoming,
  // 消 · Notify the parent that the row no longer exists so it can clean
  // up its own state (e.g. close the drawer, drop edit-mode flags).
  onAfterDelete,
  // 預け · Loan-state overlay. The drawer doesn't manage the loan
  // form itself — it surfaces a single chip that fires
  // `onOpenLoanModal` so the parent can open the dedicated
  // LoanModal. Optional: callers without loan UX leave it undefined
  // and the chip stays hidden.
  onOpenLoanModal,
  loanedTo = null,
  loanDueAt = null,
}) {
  const t = useT();
  // useId() avoids the `drawer-price-undefined` collision custom volumes hit.
  const fieldId = useId();

  // Decouple DOM lifecycle from `open` so the exit animation plays before unmount.
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

  const panelRef = useRef(null);
  // Distinguishes a true backdrop click from a text-selection drag-out so
  // releasing the selection past the panel edge doesn't cancel the edit.
  const backdropMouseDownRef = useRef(false);

  // Scroll lock + ESC + Tab cycling + initial focus + opener restore —
  // all delegated to the shared hook. See `hooks/useFocusTrap.js`.
  useFocusTrap(mounted, panelRef, onClose);

  if (!mounted) return null;
  if (typeof document === "undefined") return null;

  const overlayAnim = leaving ? "animate-fade-out" : "animate-fade-in";
  const panelAnim = leaving ? "animate-drawer-out" : "animate-drawer-in";

  const overlay = (
    <div
      className={`fixed inset-0 flex items-stretch justify-end bg-ink-0/70 backdrop-blur-[3px] ${overlayAnim}`}
      style={{ zIndex: 2147483630 }}
      onMouseDown={(e) => {
        backdropMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        // Touch path has no mousedown, so a tap is unambiguously "click
        // outside"; mouse path needs the mousedown to have started here too.
        const isTouch = e.nativeEvent?.pointerType === "touch";
        const downOnBackdrop = backdropMouseDownRef.current;
        backdropMouseDownRef.current = false;
        if (!isTouch && !downOnBackdrop) return;
        onCancel?.();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={
          isUpcoming
            ? t("volume.upcomingDetailsAria")
            : t("volume.editDrawerTitle", { n: volNum })
        }
        tabIndex={-1}
        className={`relative flex h-full w-full max-w-[26rem] flex-col overflow-hidden border-l ${
          isUpcoming
            ? "border-moegi/30 bg-gradient-to-b from-ink-1 via-ink-1 to-moegi/[0.04] shadow-[0_0_60px_-12px_rgba(163,201,97,0.32)]"
            : "border-border bg-gradient-to-b from-ink-1 via-ink-1 to-ink-0 shadow-[0_0_60px_-12px_rgba(220,38,38,0.35)]"
        } focus:outline-none ${panelAnim}`}
      >
        <span
          aria-hidden
          className={`pointer-events-none absolute -right-12 top-24 select-none font-jp text-[28rem] font-bold leading-none ${
            isUpcoming ? "text-moegi/[0.06]" : "text-hanko/[0.04]"
          }`}
          style={{ writingMode: "vertical-rl" }}
        >
          {isUpcoming ? "来" : "巻"}
        </span>

        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="relative z-10 flex items-start justify-between gap-3 border-b border-border bg-ink-1/85 p-5 backdrop-blur">
          <div className="flex items-start gap-4">
            {coverUrl ? (
              <span
                className={`relative h-24 w-16 flex-shrink-0 overflow-hidden rounded-md border shadow-md transition ${
                  isUpcoming
                    ? "border-moegi/60 ring-1 ring-moegi/40 shadow-[0_0_12px_rgba(163,201,97,0.35)]"
                    : collectorStatus
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
                  } ${
                    isUpcoming
                      ? "brightness-55 saturate-50"
                      : !ownedStatus
                        ? "brightness-50 grayscale"
                        : ""
                  }`}
                />
                {(isUpcoming || !ownedStatus) && (
                  <span className="pointer-events-none absolute inset-0 bg-ink-0/55" />
                )}
                <span
                  className={`pointer-events-none absolute bottom-0.5 right-0.5 grid min-h-4 min-w-4 place-items-center rounded-sm px-1 font-mono text-[9px] font-bold leading-none shadow ${
                    isUpcoming
                      ? "bg-moegi text-ink-0"
                      : collectorStatus
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
                  isUpcoming
                    ? "border-moegi text-moegi"
                    : collectorStatus
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
              <p
                className={`font-mono text-[10px] uppercase tracking-[0.22em] ${
                  isUpcoming ? "text-moegi" : "text-hanko"
                }`}
              >
                {isUpcoming
                  ? t("volume.upcomingDrawerEyebrow")
                  : t("volume.editDrawerEyebrow")}
              </p>
              <h2 className="mt-1.5 font-display text-xl font-semibold italic leading-tight text-washi">
                {t("volume.volume", { n: volNum })}
              </h2>
              <p className="mt-1 text-[12px] leading-snug text-washi-muted">
                {isUpcoming
                  ? t("volume.upcomingDrawerLead")
                  : t("volume.editDrawerLead")}
              </p>
              {isUpcoming && (
                <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-moegi/40 bg-moegi/10 px-2.5 py-1 font-mono text-[11px] leading-none text-moegi">
                  <span className="font-jp text-[12px] font-bold leading-none">
                    来
                  </span>
                  <span>
                    {formatShortDate(releaseDate)}
                    {daysUntilRelease != null && daysUntilRelease > 0 && (
                      <> · J−{daysUntilRelease}</>
                    )}
                    {daysUntilRelease === 0 && (
                      <> · {t("volume.upcomingCountdownToday")}</>
                    )}
                  </span>
                </p>
              )}
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

        {isUpcoming ? (
          <div className="relative z-10 flex-1 space-y-4 overflow-y-auto p-5">
            <div className="rounded-xl border border-moegi/30 bg-moegi/5 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-moegi-muted">
                {t("volume.upcomingDrawerEyebrow")}
              </p>
              <p className="mt-1 text-[13px] leading-snug text-washi">
                {t("volume.upcomingDrawerLead")}
              </p>
            </div>

            <dl className="space-y-3 text-[13px]">
              <div className="flex items-baseline gap-3 border-b border-border/60 pb-3">
                <dt className="w-24 flex-shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
                  {t("volume.upcomingSourceLabel")}
                </dt>
                <dd className="flex-1 text-washi">
                  <span className="block font-mono text-[11px] text-washi-muted">
                    {origin === "manual"
                      ? t("volume.upcomingOriginManual")
                      : t("volume.upcomingOriginApi", { source: origin })}
                  </span>
                  {announcedAt && origin !== "manual" && (
                    <span className="mt-0.5 block font-mono text-[10px] text-washi-dim">
                      {formatFreshness(announcedAt, t)}
                    </span>
                  )}
                </dd>
              </div>
              {releaseIsbn && (
                <div className="flex items-baseline gap-3 border-b border-border/60 pb-3">
                  <dt className="w-24 flex-shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
                    {t("volume.upcomingIsbn")}
                  </dt>
                  <dd className="flex-1 select-all font-mono text-[12px] text-washi">
                    {releaseIsbn}
                  </dd>
                </div>
              )}
              {releaseUrl && (
                <div className="flex items-baseline gap-3">
                  <dt className="w-24 flex-shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
                    {t("volume.upcomingPreorder")}
                  </dt>
                  <dd className="flex-1">
                    <a
                      href={releaseUrl}
                      target="_blank"
                      rel="noreferrer noopener nofollow"
                      className="inline-flex items-center gap-1.5 rounded-full border border-moegi/50 bg-moegi/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-moegi transition hover:border-moegi hover:bg-moegi/20"
                    >
                      <span className="font-jp text-[12px] font-bold leading-none">
                        来
                      </span>
                      {t("volume.upcomingPreorder")}
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
                        <path d="M7 17 17 7M9 7h8v8" />
                      </svg>
                    </a>
                  </dd>
                </div>
              )}
            </dl>

            {/* 来 · Manual-row management — only visible when this row
                came from the user's hand (origin = "manual"). API rows
                are managed by the nightly sweep; surfacing edit/delete
                on those would set the user up for a "I deleted it but
                it came back" frustration loop. */}
            {origin === "manual" && (
              <ManualUpcomingControls
                id={id}
                volNum={volNum}
                onEdit={onEditUpcoming}
                onAfterDelete={onAfterDelete}
                t={t}
              />
            )}
          </div>
        ) : (
          <div className="relative z-10 flex-1 space-y-5 overflow-y-auto p-5">
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
                  type="button"
                  onClick={() => setOwnedStatus(opt.v)}
                  // Autofocus the selected option so reflex-Space doesn't flip state.
                  data-autofocus={ownedStatus === opt.v ? true : undefined}
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
                          date: formatShortDate(readAt),
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

          <div>
            <label
              htmlFor={`${fieldId}-price`}
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim"
            >
              {t("volume.priceLabel", {
                symbol: currencySetting?.symbol || "$",
              })}
            </label>
            <input
              id={`${fieldId}-price`}
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

          <div>
            <label
              htmlFor={`${fieldId}-store`}
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim"
            >
              {t("volume.storeLabel")}
            </label>
            <StoreAutocomplete
              id={`${fieldId}-store`}
              value={purchaseLocation ?? ""}
              onChange={(e) => setPurchaseLocation(e.target.value)}
              placeholder={t("volume.storePlaceholder")}
              className="w-full rounded-lg border border-border bg-ink-1 px-3 py-2 text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
            />
          </div>

          <NoteField
            fieldId={fieldId}
            value={note ?? ""}
            onChange={setNote}
            t={t}
          />

          {/* 預け · Loan chip. Appears in two states:
              • lent → hanko-tinted band with borrower + due date,
                clicking opens the LoanModal in edit mode
              • not lent → muted "lend" CTA that opens the modal
                with an empty form. Hidden entirely when the parent
                doesn't pass `onOpenLoanModal`, when the volume is
                upcoming (no real copy yet to lend), or when the
                user doesn't currently own the tome (you can't lend
                what isn't yours). The owned gate is symmetric with
                the server's `set_loan` BadRequest. */}
          {onOpenLoanModal && !isUpcoming && ownedStatus && (
            <LoanChip
              loanedTo={loanedTo}
              loanDueAt={loanDueAt}
              onOpen={onOpenLoanModal}
              t={t}
            />
          )}
          </div>
        )}

        <div className="relative z-10 mt-auto flex gap-2 border-t border-border bg-ink-1/95 p-4">
          {isUpcoming ? (
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-lg border border-moegi/40 bg-moegi/5 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-moegi transition hover:border-moegi hover:bg-moegi/15"
            >
              {t("common.close")}
            </button>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

// Mirrors the server-side NOTE_MAX_CHARS — server caps as defence in depth.
const NOTE_MAX_CHARS_CLIENT = 2000;
function NoteField({ fieldId, value, onChange, t }) {
  const safe = String(value ?? "");
  const overSoftLimit = safe.length >= NOTE_MAX_CHARS_CLIENT * 0.95;

  const handleChange = (event) => {
    const next = event.target.value ?? "";
    if (next.length > NOTE_MAX_CHARS_CLIENT) {
      onChange(next.slice(0, NOTE_MAX_CHARS_CLIENT));
    } else {
      onChange(next);
    }
  };

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label
          htmlFor={`${fieldId}-note`}
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-washi-dim"
        >
          <span aria-hidden="true" className="font-jp text-base font-bold leading-none text-hanko-bright/70">
            記
          </span>
          {t("volume.noteLabel")}
        </label>
        <span
          aria-live="polite"
          className={`font-mono text-[10px] tabular-nums tracking-wider transition ${
            overSoftLimit ? "text-hanko-bright" : "text-washi-dim"
          }`}
        >
          {t("volume.noteCounter", {
            n: safe.length,
            max: NOTE_MAX_CHARS_CLIENT,
          })}
        </span>
      </div>
      <textarea
        id={`${fieldId}-note`}
        value={safe}
        onChange={handleChange}
        rows={6}
        maxLength={NOTE_MAX_CHARS_CLIENT}
        placeholder={t("volume.notePlaceholder")}
        spellCheck
        className="block w-full resize-y rounded-lg border border-border bg-ink-1 px-3 py-2 font-serif text-sm leading-relaxed text-washi placeholder:italic placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
      />
      <p className="mt-1.5 text-[10px] italic text-washi-muted">
        {t("volume.noteHint")}
      </p>
    </div>
  );
}

/**
 * 預け · Inline loan-state chip rendered inside the volume drawer.
 *
 * Two visual states share the same band shape:
 *   • lent (loanedTo set) → hanko-tinted, borrower name + due
 *     date prominent, kanji 預 anchored on the left
 *   • not lent → muted hairline border, mono-cap CTA
 *
 * Clicking the band fires `onOpen` so the parent surface (Volume.jsx)
 * can mount the `LoanModal` over the drawer.
 */
function LoanChip({ loanedTo, loanDueAt, onOpen, t }) {
  const isLent = Boolean(loanedTo);
  const dueLabel = loanDueAt
    ? new Date(loanDueAt).toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "2-digit",
      })
    : null;
  const overdue =
    loanDueAt && new Date(loanDueAt).getTime() < Date.now();
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`mt-4 group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
        isLent
          ? overdue
            ? "border-hanko/55 bg-hanko/10 hover:bg-hanko/15"
            : "border-gold/45 bg-gold/8 hover:bg-gold/12"
          : "border-dashed border-border bg-transparent hover:border-hanko/40 hover:bg-hanko/5"
      }`}
    >
      <span
        aria-hidden="true"
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-md font-jp text-base font-bold ${
          isLent
            ? overdue
              ? "bg-hanko/20 text-hanko-bright"
              : "bg-gold/15 text-gold"
            : "border border-border text-washi-dim"
        }`}
      >
        {isLent ? (overdue ? "過" : "預") : "貸"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
          {isLent
            ? overdue
              ? t("loans.statusOverdue")
              : t("loans.statusActive")
            : t("loans.lendCtaKicker")}
        </p>
        {isLent ? (
          <p className="mt-0.5 truncate font-display text-sm italic text-washi">
            {loanedTo}
            {dueLabel && (
              <>
                {" · "}
                <span className="font-mono text-[11px] tabular-nums not-italic text-washi-muted">
                  {t("loans.dueOn")} {dueLabel}
                </span>
              </>
            )}
          </p>
        ) : (
          <p className="mt-0.5 font-display text-sm italic text-washi-muted">
            {t("loans.lendCtaTitle")}
          </p>
        )}
      </div>
      <span
        aria-hidden="true"
        className="font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim transition group-hover:translate-x-0.5 group-hover:text-washi"
      >
        →
      </span>
    </button>
  );
}

function formatFreshness(iso, t) {
  try {
    const announced = new Date(iso);
    if (Number.isNaN(announced.getTime())) return "";
    const ms = Date.now() - announced.getTime();
    const days = Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
    const absolute = announced.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    if (days === 0) return t("volume.upcomingDiscovered", { date: absolute });
    return t("volume.upcomingDiscoveredAgo", {
      date: absolute,
      days,
    });
  } catch {
    return "";
  }
}

/**
 * 来 + 消 · Manual-row management block — shown inside the upcoming
 * panel only when `origin === "manual"`. Two CTAs:
 *   - **Edit announce** delegates back to the parent (which opens
 *     the AddUpcomingVolumeModal in edit mode).
 *   - **Delete** is two-step: first click stages the confirm UI
 *     inline, second click fires the mutation. We intentionally
 *     don't open a nested modal — the drawer is already a modal,
 *     and stacking another would force the user through three
 *     dismiss-clicks to back out of an accidental tap.
 */
function ManualUpcomingControls({ id, volNum, onEdit, onAfterDelete, t }) {
  const deleteMutation = useDeleteUpcomingVolume();
  const [confirming, setConfirming] = useState(false);

  // Reset the confirm staging if the row id changes underneath us
  // (defensive — the drawer remounts per-volume so this is rare).
  useEffect(() => {
    setConfirming(false);
  }, [id]);

  const handleDelete = async () => {
    if (!id) return;
    try {
      await deleteMutation.mutateAsync({ id });
      // The drawer doesn't have the series name in scope (it's the
      // Volume parent that holds it via context). Emit just the volume
      // number — the toast text handles a missing `name` gracefully via
      // the i18n template, and the user just confirmed the action so
      // they don't need a second cue of which series.
      notifySyncInfo({
        title: t("manga.upcomingDeletedTitle"),
        body: `${t("volume.volume", { n: volNum })}`,
      });
      // Parent handles closing the drawer.
      onAfterDelete?.();
    } catch (err) {
      notifySyncError(err, "manual-upcoming-delete");
      setConfirming(false);
    }
  };

  return (
    <div className="mt-5 border-t border-moegi/15 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-full border border-moegi/40 bg-moegi/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-moegi transition hover:border-moegi/70 hover:bg-moegi/20 active:scale-95"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3 w-3"
              aria-hidden="true"
            >
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
            {t("manga.upcomingSubmitEdit")}
          </button>
        )}

        {/* Delete CTA — two-step. First click flips to confirm state.
            Second click commits. Cancel restores the unstaged state. */}
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-hanko/40 bg-transparent px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-hanko-bright transition hover:bg-hanko/10 active:scale-95"
          >
            <span aria-hidden="true" className="font-jp text-[12px] leading-none">
              消
            </span>
            {t("manga.upcomingDeleteCta")}
          </button>
        ) : (
          <div className="ml-auto flex flex-wrap items-center gap-2 rounded-lg border border-hanko/40 bg-hanko/10 px-3 py-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-hanko-bright">
              {t("manga.upcomingDeleteConfirmTitle")}
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={deleteMutation.isPending}
                className="rounded-full border border-border bg-transparent px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="rounded-full bg-gradient-to-br from-hanko-deep to-hanko px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-washi shadow-[0_2px_8px_var(--hanko-glow)] transition hover:brightness-110 active:scale-95 disabled:opacity-60"
              >
                {deleteMutation.isPending ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-washi/30 border-t-washi" />
                    {t("manga.upcomingDeleting")}
                  </span>
                ) : (
                  t("manga.upcomingDeleteConfirm")
                )}
              </button>
            </div>
          </div>
        )}
      </div>
      {confirming && (
        <p className="mt-2 text-[11px] leading-snug text-washi-muted">
          {t("manga.upcomingDeleteConfirmBody")}
        </p>
      )}
    </div>
  );
}
