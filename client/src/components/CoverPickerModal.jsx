import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "@/components/ui/Modal.jsx";
import Skeleton from "@/components/ui/Skeleton.jsx";
import Tooltip from "@/components/ui/Tooltip.jsx";
import { useCoverPool } from "@/hooks/useCoverPool.js";
import { useT } from "@/i18n/index.jsx";

/**
 * Cover picker carousel — clicking the poster on MangaPage opens this.
 *
 *  - Enlarged hero (up to 65vh) so the user actually sees each cover
 *  - Navigation: chevron buttons, click-on-sides, swipe (pointer events),
 *    arrow keys
 *  - 「現」 (gold) on the series' current cover, 「選」 (jade) on the pending
 *    selection — the two seal kanji that anchor the whole app's semantics
 *  - Mini-strip underneath as a map: click to jump to any index
 *  - Confirm → PATCH /api/user/library/:mal_id/poster
 *
 * The "Confirm" button is only enabled when the selection differs from the
 * current cover — avoids a pointless PATCH.
 */
export default function CoverPickerModal({
  open,
  onClose,
  mal_id,
  currentUrl,
  onConfirm,
}) {
  const t = useT();
  const { data: fetchedCovers, isPending } = useCoverPool(open ? mal_id : null);
  const [selected, setSelected] = useState(currentUrl);
  const [submitting, setSubmitting] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const dragRef = useRef({ x: 0, t: 0, dragging: false });
  const stripRef = useRef(null);

  // Unified pool: fetched covers + the current poster if missing from the
  // list (happens when the current poster is a custom upload and the user
  // navigates into the picker from a series with no other custom history).
  const covers = useMemo(() => {
    const list = Array.isArray(fetchedCovers) ? [...fetchedCovers] : [];
    if (currentUrl && !list.includes(currentUrl) && currentUrl.startsWith("http")) {
      list.unshift(currentUrl);
    }
    return list;
  }, [fetchedCovers, currentUrl]);

  const selectedIdx = covers.indexOf(selected);
  const canNavigate = covers.length > 1;

  const goTo = useCallback(
    (nextIdx) => {
      if (!covers.length) return;
      const wrapped = ((nextIdx % covers.length) + covers.length) % covers.length;
      setSelected(covers[wrapped]);
    },
    [covers],
  );

  const goNext = useCallback(
    () => goTo(selectedIdx + 1),
    [goTo, selectedIdx],
  );
  const goPrev = useCallback(
    () => goTo(selectedIdx - 1),
    [goTo, selectedIdx],
  );

  // Reset selection ONLY when the modal transitions from closed to
  // open. Tracking the previous `open` value via a ref means a live
  // refetch that changes `currentUrl` mid-session (e.g. the outbox
  // flushed an earlier poster PATCH while the user is browsing) no
  // longer stomps on their in-progress click.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    prevOpenRef.current = open;
    if (justOpened) setSelected(currentUrl);
  }, [open, currentUrl]);

  // Scroll current cover into view in the strip once it renders.
  useEffect(() => {
    if (!stripRef.current || !currentUrl) return;
    const el = stripRef.current.querySelector(
      `[data-url="${CSS.escape(currentUrl)}"]`,
    );
    el?.scrollIntoView({ behavior: "instant", inline: "center", block: "nearest" });
  }, [covers, currentUrl]);

  // Keyboard navigation — works anywhere inside the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, goPrev, goNext]);

  // Pointer events on the hero — unifies touch (swipe) and mouse (click-on-
  // sides). The distinction between swipe and tap is made on release:
  //   |dx| > 40px     → swipe, direction gives prev/next
  //   short + small dx → click; left half → prev, right half → next
  const onPointerDown = (e) => {
    if (!canNavigate) return;
    // capture so pointerup always fires on the same element
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, t: Date.now(), dragging: true };
    setSwipeX(0);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.x;
    // Dampen the visual follow so the image doesn't fly off. Max ±80px.
    setSwipeX(Math.max(-80, Math.min(80, dx * 0.6)));
  };
  const onPointerUp = (e) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.x;
    const dt = Date.now() - dragRef.current.t;
    dragRef.current.dragging = false;
    setSwipeX(0);

    if (!canNavigate) return;

    // Swipe gesture
    if (Math.abs(dx) > 40) {
      if (dx > 0) goPrev();
      else goNext();
      return;
    }
    // Click-on-side: only consume short taps with tiny delta (real clicks)
    if (dt < 300 && Math.abs(dx) < 5) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < rect.width / 2) goPrev();
      else goNext();
    }
  };

  const handleConfirm = async () => {
    if (!selected || selected === currentUrl) return;
    setSubmitting(true);
    try {
      await onConfirm(selected);
    } finally {
      setSubmitting(false);
    }
  };

  const canConfirm = selected && selected !== currentUrl && !submitting;

  return (
    <Modal popupOpen={open} handleClose={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-ink-1/95 shadow-2xl">
        {/* Masthead */}
        <header className="relative shrink-0 border-b border-border px-6 py-3">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-hanko/40 to-transparent"
          />
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko">
              {t("coverPicker.label")}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
            <span className="font-mono text-[9px] uppercase tracking-wider text-washi-dim">
              {isPending
                ? t("coverPicker.loading")
                : canNavigate
                  ? `${selectedIdx + 1} / ${covers.length}`
                  : t("coverPicker.countLabel", { n: covers.length })}
            </span>
          </div>
          <h2 className="mt-0.5 font-display text-xl font-semibold italic text-washi md:text-2xl">
            {t("coverPicker.title")}
          </h2>
        </header>

        {/* Hero — the main event. Tall, click-to-navigate on sides, swipe
            on touch. Chevron buttons overlay left + right on desktop. */}
        <div
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-gradient-to-br from-ink-0 via-ink-1 to-ink-0"
          style={{ touchAction: canNavigate ? "pan-y pinch-zoom" : undefined }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragRef.current.dragging = false;
            setSwipeX(0);
          }}
        >
          {/* Ambient glow — very subtle, aesthetic continuity with the app */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-10 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(ellipse 70% 60% at 50% 40%, var(--bg-glow-red), transparent 60%)",
            }}
          />

          {/* Priority order matters for the close animation: as long as we
              have a `selected` URL (true throughout the lifetime of an open
              modal — seeded from `currentUrl` on open), we render the image
              first. Showing a <Skeleton> during the close phase would
              unmask the red ambient wash behind and produce a brief red
              flash before the overlay fade-out completes. */}
          {selected ? (
            <img referrerPolicy="no-referrer"
              key={selected}
              src={selected}
              alt=""
              draggable={false}
              className="relative max-h-[65vh] max-w-[min(100%,70vw)] rounded-lg border border-border object-contain shadow-[0_30px_80px_rgba(0,0,0,0.7)] animate-fade-in select-none"
              style={{
                transform: `translateX(${swipeX}px)`,
                transition: swipeX === 0 ? "transform 240ms cubic-bezier(.2,.8,.2,1)" : "none",
              }}
            />
          ) : isPending ? (
            <Skeleton className="h-[60vh] max-h-[540px] w-auto aspect-[2/3] rounded-lg" />
          ) : (
            <div className="grid h-[60vh] w-[40vh] max-h-[540px] place-items-center rounded-lg border border-dashed border-border bg-ink-2 text-washi-dim">
              <span
                className="font-display text-7xl italic text-hanko/40"
                title={t("badges.volume")}
              >
                巻
              </span>
            </div>
          )}

          {/* Chevrons — visible on hover (desktop). Hidden on small screens
              where swipe is the natural gesture. */}
          {canNavigate && (
            <>
              <NavChevron
                direction="prev"
                onClick={(e) => {
                  e.stopPropagation();
                  goPrev();
                }}
                label={t("coverPicker.prev")}
              />
              <NavChevron
                direction="next"
                onClick={(e) => {
                  e.stopPropagation();
                  goNext();
                }}
                label={t("coverPicker.next")}
              />
            </>
          )}

          {/* Corner seals on the hero — mirror the strip badges but bigger */}
          {!isPending && selected && (
            <HeroSeals
              isCurrent={selected === currentUrl}
              isPending={selected !== currentUrl}
              t={t}
            />
          )}
        </div>

        {/* Strip — mini overview, click any thumb to jump. Smaller than
            before so the hero keeps top billing. */}
        <div className="shrink-0 border-y border-border bg-ink-0/50 px-4 py-2">
          {isPending ? (
            <div className="flex gap-2 overflow-hidden">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-11 shrink-0 rounded-sm" />
              ))}
            </div>
          ) : covers.length === 0 ? (
            <p className="py-3 text-center text-xs italic text-washi-muted">
              {t("coverPicker.empty")}
            </p>
          ) : (
            <ul
              ref={stripRef}
              className="flex snap-x snap-mandatory gap-2 overflow-x-auto scrollbar-thin"
              role="listbox"
              aria-label={t("coverPicker.title")}
            >
              {covers.map((url, i) => {
                const isCurrent = url === currentUrl;
                const isSelected = url === selected;
                return (
                  <li key={url} data-url={url} className="shrink-0 snap-start">
                    <button
                      type="button"
                      onClick={() => setSelected(url)}
                      aria-pressed={isSelected}
                      aria-label={`${t("coverPicker.title")} ${i + 1}`}
                      className={`group relative block overflow-hidden rounded-sm border-2 transition-all duration-300 ${
                        isSelected
                          ? "border-moegi shadow-[0_0_14px_rgba(0,0,0,0.5)] -translate-y-0.5"
                          : isCurrent
                            ? "border-gold/70"
                            : "border-transparent opacity-70 hover:opacity-100 hover:-translate-y-0.5"
                      }`}
                    >
                      <img referrerPolicy="no-referrer"
                        src={url}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        className="h-16 w-11 object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      {/* Badges: CSS-only Tooltip (native `title` misfired
                          inside the scrolling strip / portaled modal). Clicks
                          on the wrapper span bubble up to the outer <button>
                          which handles selection. */}
                      {isCurrent && (
                        <span className="absolute left-0.5 top-0.5">
                          <Tooltip
                            text={t("badges.currentCover")}
                            placement="bottom"
                          >
                            <span
                              className="grid h-3.5 w-3.5 place-items-center rounded-[2px] bg-gradient-to-br from-gold to-gold-muted text-ink-0 shadow"
                              style={{ transform: "rotate(-6deg)" }}
                            >
                              <span className="font-display text-[8px] font-bold leading-none">
                                現
                              </span>
                            </span>
                          </Tooltip>
                        </span>
                      )}
                      {isSelected && !isCurrent && (
                        <span className="absolute right-0.5 top-0.5 animate-fade-in">
                          <Tooltip
                            text={t("badges.selectedCover")}
                            placement="bottom"
                          >
                            <span
                              className="grid h-3.5 w-3.5 place-items-center rounded-[2px] bg-gradient-to-br from-moegi to-moegi-muted text-ink-0 shadow"
                              style={{ transform: "rotate(6deg)" }}
                            >
                              <span className="font-display text-[8px] font-bold leading-none">
                                選
                              </span>
                            </span>
                          </Tooltip>
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Action bar */}
        <footer className="flex shrink-0 items-center justify-between gap-3 px-6 py-3">
          <p className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-wider text-washi-dim">
            {sourceLabel(selected, t)}
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-full border border-border bg-ink-2 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:border-washi/30 hover:text-washi disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="inline-flex items-center gap-1.5 rounded-full bg-hanko px-5 py-2 text-xs font-semibold uppercase tracking-wider text-washi transition hover:bg-hanko-bright active:scale-95 disabled:cursor-not-allowed disabled:bg-ink-3 disabled:text-washi-dim"
            >
              {submitting ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-washi/30 border-t-washi" />
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3 w-3"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              {t("coverPicker.confirm")}
            </button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}

/* ─────────────────── Internal presentational bits ─────────────────── */

/**
 * Chevron arrow button. Fades in on hover on desktop; stays discreet but
 * reachable on touch via the surrounding pointer logic. Hidden on ≤sm
 * screens where the click-zone hint would clash with finger ergonomics.
 */
function NavChevron({ direction, onClick, label }) {
  const isPrev = direction === "prev";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`absolute top-1/2 z-10 hidden -translate-y-1/2 grid h-12 w-12 place-items-center rounded-full border border-border bg-ink-1/70 text-washi-muted opacity-0 backdrop-blur transition duration-200 hover:bg-hanko hover:text-washi hover:border-hanko focus-visible:opacity-100 group-hover:opacity-100 md:grid ${
        isPrev ? "left-3" : "right-3"
      }`}
      // `group-hover` on the parent flex container — handled by adding
      // group class up there if needed. Fallback to focus-visible + touch
      // always shows them faintly when modal first renders (see below).
      style={{ opacity: 0.85 }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        {isPrev ? (
          <polyline points="15 18 9 12 15 6" />
        ) : (
          <polyline points="9 18 15 12 9 6" />
        )}
      </svg>
    </button>
  );
}

function HeroSeals({ isCurrent, isPending, t }) {
  // CSS-only Tooltip wrapper for the hero seals. Pointer gestures that start
  // on a seal still bubble to the parent's onPointerDown (setPointerCapture
  // on that parent funnels subsequent events there), so swipe keeps working.
  return (
    <>
      {isCurrent && (
        <span className="absolute right-4 top-4 z-10">
          <Tooltip
            text={t("coverPicker.currentBadgeTitle")}
            placement="left"
          >
            <span
              className="grid h-10 w-10 place-items-center rounded-md bg-gradient-to-br from-gold to-gold-muted text-ink-0 shadow-[0_4px_14px_rgba(201,169,97,0.6)] ring-1 ring-gold/80"
              style={{ transform: "rotate(-6deg)" }}
              aria-label={t("coverPicker.currentBadgeTitle")}
            >
              <span className="font-display text-lg font-bold leading-none">
                現
              </span>
            </span>
          </Tooltip>
        </span>
      )}
      {isPending && !isCurrent && (
        <span className="absolute right-4 top-4 z-10 animate-fade-in">
          <Tooltip
            text={t("coverPicker.selectedBadgeTitle")}
            placement="left"
          >
            <span
              className="grid h-10 w-10 place-items-center rounded-md bg-gradient-to-br from-moegi to-moegi-muted text-ink-0 shadow-[0_4px_14px_rgba(0,0,0,0.5)] ring-1 ring-moegi/80"
              style={{ transform: "rotate(6deg)" }}
              aria-label={t("coverPicker.selectedBadgeTitle")}
            >
              <span className="font-display text-lg font-bold leading-none">
                選
              </span>
            </span>
          </Tooltip>
        </span>
      )}
    </>
  );
}

/**
 * Tiny helper: tell the user which API the currently-hovered cover comes
 * from. Based purely on the URL host — matches the server's whitelist.
 */
function sourceLabel(url, t) {
  if (!url) return "";
  try {
    const host = new URL(url).host;
    if (host.endsWith("myanimelist.net")) return t("coverPicker.sourceMal");
    if (host === "uploads.mangadex.org") return t("coverPicker.sourceMangadex");
  } catch {
    /* ignore */
  }
  return t("coverPicker.sourceCustom");
}
