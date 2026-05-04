/**
 * 札 · Ledger card — the ceremonial number block used across the
 * StatsPage. A small kanji glyph in the corner, an eyebrow, the
 * big italic number, and an optional sub-label.
 *
 * Visual contract:
 *   - washi-paper bg with hairline border
 *   - corner kanji rotated −5° in the section's accent color
 *   - large display-italic value (Fraunces)
 *   - optional decorative footer (children) for sparklines, hints,
 *     or a tiny secondary stat
 *
 * Designed to be tiled at three sizes via Tailwind's grid:
 *   - `compact` : single-stat tile, 1 col on mobile, 1/3 desktop
 *   - `wide`    : double-width hero tile (sparkline / chart)
 *   - `stamp`   : square 1:1 tile that feels like a hanko stamp
 */
export default function StatLedgerCard({
  kanji,
  eyebrow,
  value,
  hint,
  sub,
  variant = "compact",
  loading = false,
  children,
  className = "",
  href,
}) {
  // Map variants to grid spans + aspect / padding tuning.
  const variantClass = (() => {
    switch (variant) {
      case "wide":
        return "md:col-span-2 lg:col-span-2";
      case "stamp":
        return "aspect-square md:aspect-auto md:row-span-2";
      case "tall":
        return "lg:row-span-2";
      default:
        return "";
    }
  })();

  const Wrapper = href ? "a" : "article";
  const wrapperProps = href ? { href } : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={`group relative isolate overflow-hidden rounded-2xl border border-border/70 bg-ink-1/50 px-5 py-5 backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[color:var(--folio-accent,var(--hanko))]/55 hover:shadow-[0_22px_36px_-22px_color-mix(in_oklab,var(--folio-accent,var(--hanko))_60%,transparent)] md:px-6 md:py-6 ${variantClass} ${className}`}
    >
      {/* Paper grain — same noise overlay used on the SealsPage
          so cards feel printed on identical washi rather than
          generated independently. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
        }}
      />

      {/* Corner kanji — section accent driven from the parent
          folio's `--folio-accent` CSS variable. */}
      {kanji ? (
        <span
          aria-hidden="true"
          className="absolute right-3 top-3 select-none font-jp text-2xl font-bold leading-none md:text-3xl"
          style={{
            color: "var(--folio-accent, var(--hanko))",
            opacity: 0.32,
            transform: "rotate(-5deg)",
          }}
        >
          {kanji}
        </span>
      ) : null}

      <div className="relative">
        {eyebrow ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-washi-muted">
            {eyebrow}
          </p>
        ) : null}

        <div className="mt-2 flex items-baseline gap-2">
          {loading ? (
            <span className="block h-9 w-24 animate-pulse rounded-md bg-ink-2/60" />
          ) : (
            <span className="font-display text-3xl font-light italic leading-none tracking-tight text-washi md:text-4xl">
              {value}
            </span>
          )}
          {sub ? (
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-washi-muted">
              {sub}
            </span>
          ) : null}
        </div>

        {hint ? (
          <p className="mt-2 font-display text-[12px] italic leading-snug text-washi-muted md:text-[13px]">
            {hint}
          </p>
        ) : null}

        {children ? <div className="relative mt-4">{children}</div> : null}
      </div>
    </Wrapper>
  );
}
