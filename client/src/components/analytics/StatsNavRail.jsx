/**
 * 索 · StatsPage section navigator.
 *
 * Two layouts share one component:
 *   - mobile: horizontal chip-row that scrolls under the hero
 *   - desktop: sticky vertical rail anchored to the left of the
 *     content column. Chips become tall pills with a kanji glyph.
 *
 * Active state is driven by an `IntersectionObserver` on each
 * folio anchor. The currently-most-visible folio's id wins; if
 * nothing is in view (e.g. user scrolls past the last folio's
 * footer) we fall back to the last seen one.
 */
import { useEffect, useState } from "react";

export default function StatsNavRail({ sections, t }) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const targets = sections
      .map((s) => document.getElementById(s.id))
      .filter(Boolean);
    if (!targets.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        // Pick the entry with the highest intersectionRatio that
        // is currently intersecting. Keeps the active chip stable
        // when adjacent folios overlap the viewport.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        // Bias the observer towards the upper-middle of the
        // viewport so a section is "active" once its heading is
        // comfortably on screen, not only when the bottom edge is.
        rootMargin: "-20% 0px -55% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );
    targets.forEach((t) => obs.observe(t));
    return () => obs.disconnect();
  }, [sections]);

  const handleJump = (id) => (e) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id);
  };

  return (
    <>
      {/* Mobile chip-row — fades the right edge so the user
          notices there's more to scroll. */}
      <nav
        aria-label={t("stats.nav.aria")}
        className="sticky top-0 z-20 -mx-4 mb-2 overflow-x-auto bg-ink-0/80 px-4 backdrop-blur-md sm:-mx-6 sm:px-6 lg:hidden"
      >
        <ul className="flex gap-2 py-3">
          {sections.map((s) => {
            const active = s.id === activeId;
            return (
              <li key={s.id} className="shrink-0">
                <a
                  href={`#${s.id}`}
                  onClick={handleJump(s.id)}
                  className={`group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 transition ${
                    active
                      ? "border-[color:var(--accent,var(--hanko))] bg-[color:var(--accent,var(--hanko))]/10 text-washi"
                      : "border-border bg-ink-1/40 text-washi-muted hover:text-washi"
                  }`}
                  style={{ "--accent": `var(--${s.accent})` }}
                >
                  <span
                    aria-hidden="true"
                    className="font-jp text-base font-bold leading-none"
                    style={{ color: `var(--${s.accent})` }}
                  >
                    {s.kanji}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
                    {s.label}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Desktop vertical rail — sticky inside the grid column. */}
      <nav
        aria-label={t("stats.nav.aria")}
        className="hidden lg:sticky lg:top-24 lg:block lg:self-start"
      >
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.32em] text-washi-dim">
          {t("stats.nav.eyebrow")}
        </p>
        <ul className="flex flex-col gap-1">
          {sections.map((s) => {
            const active = s.id === activeId;
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  onClick={handleJump(s.id)}
                  className={`relative flex items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                    active
                      ? "border-[color:var(--accent)] bg-[color:var(--accent)]/10 text-washi"
                      : "border-transparent text-washi-muted hover:bg-ink-1/40 hover:text-washi"
                  }`}
                  style={{ "--accent": `var(--${s.accent})` }}
                >
                  {/* Vermillion dot — only visible on the active
                      pill. Acts like a hanko stamp marking the
                      reader's place in the ledger. */}
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 top-1/2 h-7 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity ${active ? "opacity-100" : "opacity-0"}`}
                    style={{ background: `var(--${s.accent})` }}
                  />
                  <span
                    aria-hidden="true"
                    className="grid h-8 w-8 place-items-center rounded-md border font-jp text-lg font-bold leading-none"
                    style={{
                      borderColor: active
                        ? `var(--${s.accent})`
                        : "var(--border)",
                      color: `var(--${s.accent})`,
                      transform: active ? "rotate(-3deg)" : "rotate(0deg)",
                      transition: "transform 220ms ease",
                    }}
                  >
                    {s.kanji}
                  </span>
                  <span className="flex-1 font-mono text-[11px] uppercase tracking-[0.22em]">
                    {s.label}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
