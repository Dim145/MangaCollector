import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/index.jsx";
import {
  DEFAULT_SORT,
  SORT_KEYS,
  defaultDirFor,
  normalizeSort,
} from "@/utils/librarySort.js";

/**
 * 並 · Sort menu for the Dashboard grid.
 *
 * Sits in MangaSearchBar's `additionalButtons` slot next to the tag
 * FilterButton and borrows its shape: a kanji button that names the
 * current order, and an anchored popover with one radio per key plus
 * a footer button that flips the direction. Picking a key selects its
 * natural direction (see `SORT_KEYS`); flipping is a separate,
 * deliberate action so a click on the current key never surprises.
 *
 * State lives in the Dashboard (`sort` / `onChange`) — it is persisted
 * with the rest of the view state and applied in `sortLibrary`.
 */

const LABEL_KEYS = {
  title: "dashboard.sortByTitle",
  added: "dashboard.sortByAdded",
  updated: "dashboard.sortByUpdated",
  progress: "dashboard.sortByProgress",
  missing: "dashboard.sortByMissing",
  owned: "dashboard.sortByOwned",
  author: "dashboard.sortByAuthor",
  upcoming: "dashboard.sortByUpcoming",
};

export default function SortMenu({ sort, onChange }) {
  const t = useT();
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const [open, setOpen] = useState(false);
  const current = normalizeSort(sort);
  const isDefault =
    current.key === DEFAULT_SORT.key && current.dir === DEFAULT_SORT.dir;
  const arrow = current.dir === "asc" ? "↑" : "↓";

  // Same live-anchoring as the tag popover: the panel follows the
  // button through scroll/resize by writing straight to the DOM.
  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      const btn = buttonRef.current;
      const pop = popoverRef.current;
      if (!btn || !pop) return;
      const r = btn.getBoundingClientRect();
      pop.style.top = `${r.bottom + 8}px`;
      pop.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    };
    reposition();
    window.addEventListener("scroll", reposition, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, { capture: true });
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  // Outside-click + Escape dismiss.
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (buttonRef.current?.contains(e.target)) return;
      if (e.target.closest?.("[data-sort-popover]")) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keyup", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keyup", onKey);
    };
  }, [open]);

  const pick = (id) => {
    if (id !== current.key) onChange?.({ key: id, dir: defaultDirFor(id) });
  };
  const flip = () =>
    onChange?.({ key: current.key, dir: current.dir === "asc" ? "desc" : "asc" });

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("dashboard.sortOpen")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("dashboard.sortShort")}
        className={`relative inline-flex flex-1 items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition sm:flex-none ${
          !isDefault || open
            ? "border-gold/60 bg-gold/10 text-washi hover:bg-gold/20"
            : "border-border bg-ink-1/60 text-washi-muted hover:border-gold/50 hover:text-washi"
        }`}
      >
        <span aria-hidden="true" className="font-jp text-[15px] leading-none">
          並
        </span>
        <span className="truncate">{t(LABEL_KEYS[current.key])}</span>
        <span
          aria-hidden="true"
          className={`font-mono text-[11px] leading-none ${
            isDefault ? "text-washi-dim" : "text-gold"
          }`}
        >
          {arrow}
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            data-sort-popover
            role="dialog"
            aria-modal="false"
            aria-labelledby="sort-popover-title"
            style={{
              position: "fixed",
              top: -9999,
              right: -9999,
              zIndex: 2147483620,
              width: "min(calc(100vw - 16px), 300px)",
            }}
            className="animate-slide-down flex max-h-[min(70vh,520px)] flex-col overflow-hidden rounded-xl border border-border bg-ink-1/98 shadow-2xl"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -right-3 -top-2 select-none font-jp text-[110px] leading-none text-gold/[0.06]"
            >
              並
            </span>

            <div className="relative border-b border-border/60 px-4 py-3">
              <p
                id="sort-popover-title"
                className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim"
              >
                {t("dashboard.sortLabel")}
              </p>
              <p className="mt-0.5 font-display text-[15px] italic leading-tight text-washi">
                {t("dashboard.sortTitle")}
              </p>
            </div>

            <div
              role="radiogroup"
              aria-label={t("dashboard.sortTitle")}
              className="relative flex-1 overflow-y-auto px-2 py-2"
            >
              <ul className="flex flex-col gap-0.5">
                {SORT_KEYS.map((k) => {
                  const active = k.id === current.key;
                  return (
                    <li key={k.id}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => pick(k.id)}
                        className={`group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition ${
                          active
                            ? "bg-gold/15 text-washi"
                            : "text-washi-muted hover:bg-ink-2/70 hover:text-washi"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`font-jp text-[13px] leading-none transition-colors ${
                            active
                              ? "text-gold"
                              : "text-washi-dim group-hover:text-washi-muted"
                          }`}
                        >
                          {k.glyph}
                        </span>
                        <span className="flex-1 truncate font-display text-[14px] italic tracking-tight">
                          {t(LABEL_KEYS[k.id])}
                        </span>
                        {active && (
                          <span
                            aria-hidden="true"
                            className="font-mono text-[11px] text-gold"
                          >
                            {arrow}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="relative flex items-center justify-between gap-3 border-t border-border/60 bg-ink-2/40 px-4 py-2.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
                {t(
                  current.dir === "asc"
                    ? "dashboard.sortDirAsc"
                    : "dashboard.sortDirDesc",
                )}
              </span>
              <button
                type="button"
                onClick={flip}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-washi-muted transition hover:bg-gold/10 hover:text-gold"
              >
                <span aria-hidden="true" className="font-mono text-[12px] leading-none">
                  {current.dir === "asc" ? "↓" : "↑"}
                </span>
                {t("dashboard.sortFlip")}
              </button>
            </div>
            <p className="relative border-t border-border/40 px-4 py-2 font-display text-[11px] italic text-washi-dim">
              {t("dashboard.sortGapsNote")}
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}
