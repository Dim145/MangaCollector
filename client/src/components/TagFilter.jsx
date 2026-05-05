import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/index.jsx";

/**
 * Tag filter for the Dashboard — Proposition B layout.
 *
 * Exports two small pieces so the Dashboard can place them where they
 * make sense in the existing layout:
 *
 *   <FilterButton>  — sits inside MangaSearchBar's `additionalButtons`
 *                     slot. A 題 kanji button, shows a red badge when
 *                     tags are active, opens an anchored popover with
 *                     the full tag list + in-panel search + footer
 *                     (live result counter · release all · done).
 *
 *   <ActiveChips>   — a discreet row "Filtré par : [shōnen ×] [drame ×]"
 *                     rendered between the controls and the grid, only
 *                     when `activeTags.size > 0`. Zero chrome when idle.
 *
 * Rationale for splitting: the button owns the popover state but nothing
 * else. The chips are fully stateless and don't need the popover logic;
 * they should also be able to collapse/wrap independently of where the
 * button lives in the layout.
 */

/* ═══════════════════════════════════════════════════════════════════
 * <FilterButton> — 題 kanji button + anchored popover
 * ═══════════════════════════════════════════════════════════════════ */

export function FilterButton({
  library,
  activeTags,
  onToggle,
  onClear,
  resultsCount,
}) {
  const t = useT();
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Whole-library tag counts — picking a tag doesn't reshuffle neighbours.
  const tags = useMemo(() => {
    const counts = new Map();
    for (const m of library) {
      for (const g of m.genres ?? []) {
        const name = (g ?? "").trim();
        if (!name) continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
  }, [library]);

  const filteredTags = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((x) => x.name.toLowerCase().includes(q));
  }, [tags, query]);

  // Live-track the button's bounding rect so the popover follows it during
  // scroll/resize. useLayoutEffect so the first paint already has correct
  // coords (no flash at the placeholder -9999px). We write directly to the
  // DOM via popoverRef (no setState) — scroll listeners fire at composition
  // rate, so the popover stays glued to the button without re-renders.
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
    // `capture: true` catches scrolls on any ancestor (grid container,
    // window, etc.) — we want the popover to track the button across every
    // scroll context that could move it.
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
      if (e.target.closest?.("[data-tag-popover]")) return;
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

  // Reset in-panel search when the popover closes.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Nothing to filter by → don't render the button.
  if (tags.length === 0) return null;

  const activeCount = activeTags.size;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={
          activeCount > 0
            ? t("dashboard.openFiltersActive", {
                n: activeCount,
                label: t("dashboard.tagsSelected"),
              })
            : t("dashboard.openFilters")
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("dashboard.genreFilterLabel")}
        className={`relative inline-flex flex-1 items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition sm:flex-none ${
          activeCount > 0 || open
            ? "border-hanko/60 bg-hanko/15 text-washi hover:bg-hanko/25"
            : "border-border bg-ink-1/60 text-washi-muted hover:border-hanko/50 hover:text-washi"
        }`}
      >
        {/* 題 kanji — in JP serif, slightly larger than body label */}
        <span
          aria-hidden="true"
          className="font-jp text-[15px] leading-none"
        >
          題
        </span>
        {/* Label — always visible. The 題 kanji alone isn't readable for
            anyone unfamiliar with Japanese, so the romanised label stays
            on mobile too. The search-bar row is flex-col on <sm anyway,
            so there's width to spare. */}
        <span>{t("dashboard.filterShort")}</span>
        {/* Badge — hanko seal with the count */}
        {activeCount > 0 && (
          <span
            key={activeCount}
            className="animate-stamp grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-hanko px-1.5 font-mono text-[10px] font-bold tabular-nums text-washi shadow-[0_0_0_2px_var(--ink-0)]"
          >
            {activeCount}
          </span>
        )}
      </button>

      {/* Popover — portaled, live-tracked to the button's bounding rect.
          Initial top/right are set to -9999px so the first frame doesn't
          flash at the page origin before the layout-effect repositions it
          (the effect sets the real coords synchronously before paint). */}
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            data-tag-popover
            role="dialog"
            aria-modal="false"
            aria-labelledby="tag-popover-title"
            style={{
              position: "fixed",
              top: -9999,
              right: -9999,
              zIndex: 2147483620,
              width: "min(calc(100vw - 16px), 340px)",
              // 遷 · Pin the popover to its own VT snapshot so the
              // tag-toggle View Transition (which hoists every Manga
              // card via `cover-{mal_id}`) doesn't paint card images
              // *above* the popover for ~250ms. With its own name,
              // the popover is captured as an independent snapshot
              // with its semi-opaque `bg-ink-1/98` background baked
              // in, and stays in its own pseudo-element layer.
              // The CSS rule in `styles/index.css` pins the
              // `::view-transition-group(tag-popover)` z-index above
              // the cards so it always wins z-order during the morph.
              viewTransitionName: "tag-popover",
            }}
            className="animate-slide-down flex max-h-[min(70vh,520px)] flex-col overflow-hidden rounded-xl border border-border bg-ink-1/98 shadow-2xl"
          >
            {/* Decorative watermark kanji — sits behind content, top-right */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -right-3 -top-2 select-none font-jp text-[110px] leading-none text-hanko/[0.06]"
            >
              題
            </span>

            {/* Header */}
            <div className="relative border-b border-border/60 px-4 py-3">
              <p
                id="tag-popover-title"
                className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim"
              >
                {t("dashboard.genresLabel")}
              </p>
              <p className="mt-0.5 font-display text-[15px] italic leading-tight text-washi">
                {t("dashboard.filterTitle")}
              </p>
            </div>

            {/* In-panel search — only if many tags */}
            {tags.length > 10 && (
              <div className="relative border-b border-border/60 px-4 py-2.5">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="pointer-events-none absolute left-7 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-washi-dim"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("dashboard.searchTags")}
                  className="w-full rounded-md border border-border bg-ink-2/60 py-1.5 pl-8 pr-3 font-sans text-[13px] text-washi placeholder:text-washi-dim focus:border-hanko/60 focus:outline-none focus:ring-2 focus:ring-hanko/30"
                  autoFocus
                />
              </div>
            )}

            {/* Tag list */}
            <div className="relative flex-1 overflow-y-auto px-2 py-2">
              {filteredTags.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-washi-muted">
                  {t("dashboard.searchNoMatch")}
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {filteredTags.map(({ name, count }) => {
                    const active = activeTags.has(name);
                    return (
                      <li key={name}>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={active}
                          onClick={() => onToggle(name)}
                          className={`group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition ${
                            active
                              ? "bg-hanko/15 text-washi"
                              : "text-washi-muted hover:bg-ink-2/70 hover:text-washi"
                          }`}
                        >
                          {/* Enso toggle indicator — hand-brushed feel */}
                          <span
                            aria-hidden="true"
                            className={`font-jp text-[13px] leading-none transition-colors ${
                              active
                                ? "text-hanko-bright"
                                : "text-washi-dim group-hover:text-washi-muted"
                            }`}
                          >
                            {active ? "●" : "○"}
                          </span>
                          <span className="flex-1 truncate font-display text-[14px] italic capitalize tracking-tight">
                            {name}
                          </span>
                          <span
                            className={`font-mono text-[10px] tabular-nums transition-colors ${
                              active ? "text-washi" : "text-washi-dim"
                            }`}
                          >
                            {count}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Footer — live results + clear */}
            <div className="relative flex items-center justify-between gap-3 border-t border-border/60 bg-ink-2/40 px-4 py-2.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
                <span
                  key={resultsCount}
                  className="animate-fade-in font-display text-sm not-italic tabular-nums text-hanko-bright"
                >
                  {resultsCount}
                </span>{" "}
                {t("dashboard.resultsInline")}
              </span>
              <button
                type="button"
                onClick={onClear}
                disabled={activeCount === 0}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-washi-muted transition hover:bg-hanko/10 hover:text-hanko-bright disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-washi-muted"
              >
                <span aria-hidden="true" className="font-jp text-[12px] leading-none">
                  解
                </span>
                {t("dashboard.clearTags")}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * <ActiveChips> — row of removable chips shown only when tags are active
 * ═══════════════════════════════════════════════════════════════════ */

export function ActiveChips({ activeTags, onToggle, onClear }) {
  const t = useT();
  if (activeTags.size === 0) return null;

  // Stable-ish ordering — alpha inside the chip row so chips don't swap
  // positions as they're added/removed (which would be disorienting).
  const list = [...activeTags].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  return (
    <div
      className="mb-5 flex flex-wrap items-center gap-2 animate-fade-in"
      aria-label={t("dashboard.activeFiltersLabel")}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
        {t("dashboard.filteredBy")}
      </span>
      {list.map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => onToggle(name)}
          aria-label={t("dashboard.removeChip", { name })}
          className="mizuhiki-chip"
        >
          <MizuhikiKnot />
          <span className="capitalize">{name}</span>
          <MizuhikiFray />
        </button>
      ))}
      {activeTags.size > 1 && (
        <button
          type="button"
          onClick={onClear}
          className="ml-1 inline-flex items-center gap-1 rounded-full px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-washi-muted transition hover:text-hanko-bright"
        >
          <span aria-hidden="true" className="font-jp text-[12px] leading-none">
            解
          </span>
          {t("dashboard.clearTags")}
        </button>
      )}
    </div>
  );
}

/**
 * 結 · Mizuhiki knot — the ornamental crossing-cord SVG that
 * sits at the leading edge of each tag chip. Two curved paths
 * forming an X with a small filled circle at the crossing
 * point — the simplest reading of "this is a tied cord". Stroke
 * inherits the chip's `--chip-accent` so the knot tracks the
 * tag's colour story.
 */
function MizuhikiKnot() {
  return (
    <span className="mizuhiki-knot" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path
          d="M 3 5 Q 7 5 12 12 T 21 5"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M 3 19 Q 7 19 12 12 T 21 19"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

/**
 * 房 · Mizuhiki fray — three short strokes fanning out from
 * the trailing edge of the chip, mimicking the unbound cord
 * ends that hang off a knotted bundle. Doubles as the remove
 * affordance — the chip click removes the tag, but the fray
 * is what the user's eye lands on for "this is the dismiss
 * end". Rotates 15° on chip hover (see styles/index.css) to
 * cue interactivity.
 */
function MizuhikiFray() {
  return (
    <span className="mizuhiki-fray" aria-hidden="true">
      <svg viewBox="0 0 16 24">
        <path d="M 1 12 L 14 4" stroke="currentColor" strokeWidth="1.4" />
        <path d="M 1 12 L 14 12" stroke="currentColor" strokeWidth="1.4" />
        <path d="M 1 12 L 14 20" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </span>
  );
}
