/**
 * 折 · Folio — a section in the Stats ledger.
 *
 * Each folio carries:
 *   - a giant rotated kanji watermark anchored top-right
 *   - an eyebrow + display-italic title + JP subtitle
 *   - an ink-brushstroke divider underneath the heading
 *   - section accent color (driven via inline `--folio-accent`
 *     CSS variable so the children can opt in via Tailwind's
 *     arbitrary-value syntax: `text-[var(--folio-accent)]`).
 *
 * Accents are CSS variables already defined in the design tokens
 * (`--hanko`, `--gold`, `--moegi`, `--sakura`, `--ai`). Children
 * pick which to use; this component just propagates whichever the
 * parent passes.
 */
export default function SectionFolio({
  id,
  kanji,
  eyebrow,
  title,
  subtitle,
  accent = "hanko",
  children,
  delayMs = 0,
}) {
  const accentVar = `var(--${accent})`;

  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="relative scroll-mt-20 py-12 md:py-16"
      style={{ "--folio-accent": accentVar }}
    >
      {/* Kanji watermark — large, low opacity, slightly rotated.
          Pointer-events disabled so it never intercepts clicks
          even when it visually drifts over a card. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-2 top-2 select-none font-jp text-[clamp(7rem,18vw,14rem)] font-bold leading-none text-washi-dim/[0.06] md:-right-6 md:-top-2"
        style={{
          color: accentVar,
          opacity: 0.06,
          transform: "rotate(-6deg)",
        }}
      >
        {kanji}
      </span>

      <header
        className="relative mb-8 md:mb-10 animate-fade-up"
        style={{ animationDelay: `${delayMs}ms` }}
      >
        <p
          className="font-mono text-[10px] uppercase tracking-[0.32em]"
          style={{ color: accentVar }}
        >
          {eyebrow}
        </p>

        <h2
          id={`${id}-title`}
          className="mt-2 flex flex-wrap items-baseline gap-3 font-display text-3xl font-light italic leading-[1.05] tracking-tight text-washi md:text-5xl"
        >
          <span
            aria-hidden="true"
            className="font-jp text-2xl font-bold not-italic md:text-4xl"
            style={{
              color: accentVar,
              transform: "rotate(-3deg)",
              display: "inline-block",
            }}
          >
            {kanji}
          </span>
          <span>{title}</span>
        </h2>

        {subtitle ? (
          <p className="mt-3 max-w-xl font-display text-sm italic text-washi-muted md:text-base">
            {subtitle}
          </p>
        ) : null}

        {/* Brushstroke divider — hand-drawn-ish SVG path that
            tapers at both ends. Uses the existing
            `.brushstroke-path` class which animates the stroke
            painting left-to-right when the section enters view. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 320 12"
          preserveAspectRatio="none"
          className="mt-6 h-3 w-48"
        >
          <path
            className="brushstroke-path"
            d="M 0 6 C 32 10, 80 1, 130 6 S 240 11, 320 4"
            stroke={accentVar}
            strokeWidth="2.4"
            strokeLinecap="round"
            fill="none"
            opacity="0.85"
          />
          <path
            d="M 4 7 C 30 9, 80 3, 132 7 S 240 10, 316 5"
            stroke={accentVar}
            strokeWidth="0.6"
            strokeLinecap="round"
            fill="none"
            opacity="0.5"
          />
        </svg>
      </header>

      <div className="relative">{children}</div>
    </section>
  );
}
