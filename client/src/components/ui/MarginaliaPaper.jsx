import EmptyStateGlyph from "./EmptyStateGlyph.jsx";

/**
 * 余白 Yohaku · Marginalia paper — empty-state shell.
 *
 * Empty states in this app used to render as a simple dashed
 * border + giant kanji watermark, which read as "card with
 * nothing inside". The refonte treats the empty state as the
 * margin of a scholar's notebook: the page itself carries
 * presence even when the contents haven't been inscribed yet.
 *
 * The shell composes:
 *   • A washi-tinted panel sitting on the dark page (cream
 *     overlay built via `color-mix` so it tracks the active
 *     accent palette).
 *   • Faint vertical ruling — `genkō yōshi` style — running
 *     down the panel like the columns of a vertical-text
 *     manuscript, set at low contrast so they read as paper
 *     texture rather than UI chrome.
 *   • A small `第N` chapter ribbon top-left and a tiny hanko
 *     stamp top-right: the archivist's signature on the page.
 *   • The big kanji glyph (rendered through `EmptyStateGlyph`'s
 *     existing turbulence filter) sits centre-right, off-axis,
 *     so the marginalia annotation in the bottom-right has
 *     room to breathe.
 *   • A handwritten-style annotation in the bottom-right
 *     margin: italic display font, rotated -7°, low opacity.
 *     It renders the user-supplied `inscription` text — a
 *     short ceremonial line that makes the absence intentional
 *     ("rien à archiver pour aujourd'hui", "le rayon est
 *     désert", etc.).
 *
 * Composition slots:
 *   • `glyph`        — kanji to render as the bleeding watermark
 *   • `chapterMark`  — string for the top-left ribbon (e.g. "第七")
 *   • `cornerStamp`  — single-glyph stamp for the top-right
 *   • `inscription`  — the marginalia handwriting (string)
 *   • `accent`       — Tailwind colour class root (default `hanko`)
 *   • `glyphRotation` — angle for the kanji watermark
 *   • children       — title, body, CTA — rendered in a centred
 *                      column over the glyph backdrop
 *
 * Accent: defaults to the hanko cinnabar; passing `moegi` or
 * `gold` re-tints the ribbon, stamp, ruled lines, and brush
 * separator so each surface can carry its own colour story
 * (Backlog → moegi green = "ready to read", Calendar → ai blue
 * = "scheduled", Friends → murasaki = "correspondence").
 */
export default function MarginaliaPaper({
  glyph = "空",
  glyphRotation = -3,
  chapterMark,
  cornerStamp,
  inscription,
  accent = "hanko",
  className = "",
  children,
}) {
  // Map the accent name to the CSS variable we'll inline so the
  // ribbon / stamp / rule lines share one colour. We intentionally
  // only support a curated set — these are the accent palettes
  // that have explicit OKLCH tokens defined in `styles/index.css`.
  const accentVar = ACCENT_TO_VAR[accent] ?? ACCENT_TO_VAR.hanko;

  return (
    <div
      className={`marginalia-paper relative isolate overflow-hidden rounded-2xl border border-border/60 px-6 py-14 text-center backdrop-blur-sm md:px-12 md:py-20 animate-fade-up ${className}`}
      style={{
        // Cream washi overlay on the dark page. Two stacked
        // layers: a near-transparent radial bloom in the centre
        // (the ink-puddle echo) + a vertical-stripe pattern at
        // ~5% opacity that reads as `genkō yōshi` ruling. The
        // base panel colour is the standard ink-1 surface.
        background: [
          // Centre bloom — pulls the eye toward the kanji.
          `radial-gradient(ellipse at 50% 45%, color-mix(in oklab, ${accentVar} 8%, transparent) 0%, transparent 60%)`,
          // Vertical ruling — Japanese composition paper stripes.
          // 1.6rem column, 1px line, very low opacity. Fixed
          // `to right` so the columns line up on the panel
          // regardless of the surrounding page rhythm.
          `repeating-linear-gradient(to right, transparent 0, transparent 1.55rem, color-mix(in oklab, ${accentVar} 5%, transparent) 1.55rem, color-mix(in oklab, ${accentVar} 5%, transparent) 1.6rem)`,
          // Aged paper grain — barely-there cream tint that
          // sits over the ink-1 surface. Mixing with washi at
          // 4% gives a warm undertone without lightening the
          // panel enough to break the dark theme.
          `linear-gradient(180deg, color-mix(in oklab, var(--washi) 4%, transparent) 0%, transparent 70%)`,
          // Base ink panel — keeps the surface anchored to the
          // dark theme even after the overlays composite.
          `color-mix(in oklab, var(--ink-1) 92%, transparent)`,
        ].join(", "),
      }}
    >
      {/* 第N · Top-left chapter ribbon. Rendered as a kanji-only
          string (e.g. "第七") with a thin underline brushstroke
          so it reads as the running header of a printed volume,
          not as a UI label. Hidden on coarse breakpoints when
          the inscription would crowd the layout. */}
      {chapterMark ? (
        <span
          aria-hidden="true"
          className="absolute left-4 top-4 hidden items-baseline gap-1.5 sm:flex"
          style={{ color: accentVar }}
        >
          <span className="font-jp text-[11px] font-semibold tracking-[0.32em] opacity-70">
            {chapterMark}
          </span>
          <span
            className="block h-[1px] w-8 origin-left scale-x-100 opacity-50"
            style={{ background: accentVar }}
          />
        </span>
      ) : null}

      {/* 印 · Top-right corner stamp. A single kanji inside a
          dotted ring — looks like a pressed seal in the corner of
          a manuscript page. Sits above the kanji backdrop so the
          stamp reads as a separate inscription, not part of the
          watermark. */}
      {cornerStamp ? (
        <span
          aria-hidden="true"
          className="absolute right-4 top-4 hidden grid place-items-center sm:grid"
          style={{ width: "2.25rem", height: "2.25rem" }}
        >
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full border opacity-40"
            style={{
              borderColor: accentVar,
              borderStyle: "dashed",
            }}
          />
          <span
            className="font-jp text-[14px] font-bold leading-none opacity-70"
            style={{ color: accentVar }}
          >
            {cornerStamp}
          </span>
        </span>
      ) : null}

      {/* Kanji backdrop — pulled slightly off-centre to the right
          (15% offset) so the marginalia inscription has room in
          the bottom-right corner without overlapping the brush
          stroke. The backdrop is the same `EmptyStateGlyph` the
          Dashboard already uses; we only colour-tint it via the
          ambient `color` cascade so the kanji picks up the same
          accent as the ribbon + stamp. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 grid place-items-center"
        style={{ color: `color-mix(in oklab, ${accentVar} 10%, transparent)` }}
      >
        <EmptyStateGlyph glyph={glyph} rotation={glyphRotation} />
      </span>

      {/* Foreground content — title / body / CTA all live here. */}
      <div className="relative z-10 flex flex-col items-center gap-2.5">
        {children}
      </div>

      {/* 余白の銘 · Marginalia inscription. Bottom-right, italic
          display, slight rotation. The brushstroke separator
          above it gives the line a "this was inscribed by hand"
          feel rather than "this is a footer label". On mobile
          we drop the inscription entirely — the panel is too
          narrow to support a rotated cursive line without the
          chapter mark crowding it. */}
      {inscription ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-5 right-4 hidden max-w-[14rem] flex-col items-end gap-1.5 sm:flex md:right-8 md:bottom-6 md:max-w-[18rem]"
        >
          <span
            className="block h-[2px] w-12 origin-right opacity-50"
            style={{
              background: `linear-gradient(to left, ${accentVar} 0%, transparent 100%)`,
            }}
          />
          <span
            className="font-display text-[11px] italic leading-snug text-washi-muted/85 md:text-xs"
            style={{ transform: "rotate(-7deg)" }}
          >
            {inscription}
          </span>
        </span>
      ) : null}
    </div>
  );
}

const ACCENT_TO_VAR = {
  hanko: "var(--hanko)",
  gold: "var(--gold)",
  moegi: "var(--moegi)",
  sakura: "var(--sakura)",
  ai: "var(--ai)",
};
