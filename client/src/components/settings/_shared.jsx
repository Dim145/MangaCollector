// Shared primitives for the SettingsPage chapter files. Card / CardHeader /
// RadioCard are tile-level building blocks used by every chapter; Chapter,
// SubBlock and ChapterHeading are the structural scaffolding that each
// chapter file uses to wrap its own contents.

export function Card({ children, danger = false }) {
  return (
    <section
      className={`rounded-2xl border p-4 backdrop-blur sm:p-6 ${
        danger
          ? "border-hanko/20 bg-gradient-to-br from-hanko/5 to-ink-1/50"
          : "border-border bg-ink-1/50"
      }`}
    >
      {children}
    </section>
  );
}

export function CardHeader({ title, body, kanji, accent = "hanko" }) {
  const accentClasses = {
    hanko: "from-hanko-deep to-hanko shadow-[0_2px_10px_var(--hanko-glow)]",
    gold: "from-gold to-gold-muted shadow-[0_2px_10px_rgba(201,169,97,0.35)]",
    moegi: "from-moegi to-moegi-muted shadow-[0_2px_10px_rgba(163,201,97,0.35)]",
  };
  return (
    <div className="mb-4 flex items-start gap-3">
      {kanji && (
        <span
          aria-hidden="true"
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-md bg-gradient-to-br text-washi ${accentClasses[accent]}`}
          style={{ transform: "rotate(-4deg)" }}
        >
          <span className="font-jp text-sm font-bold leading-none">{kanji}</span>
        </span>
      )}
      <div className="min-w-0">
        <h3 className="font-display text-base font-semibold text-washi sm:text-lg">
          {title}
        </h3>
        {body && <p className="mt-1 text-xs text-washi-muted">{body}</p>}
      </div>
    </div>
  );
}

export function RadioCard({ checked, onClick, name, value, children }) {
  return (
    <label
      className={`group relative cursor-pointer overflow-hidden rounded-xl border p-3 transition ${
        checked
          ? "border-hanko/60 bg-hanko/10"
          : "border-border bg-ink-0/40 hover:border-border/80"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onClick}
        className="sr-only"
      />
      {children}
      {checked && (
        <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-hanko text-washi">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-2.5 w-2.5"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      )}
    </label>
  );
}

export function Chapter({ id, chapter, title, subtitle, children, t }) {
  // `scroll-margin-top` clears the sticky mobile ribbon (~64px) + the
  // breathing room above the first card. Numbers are visual feel, not
  // pixel-precise — adjust together with the ribbon's own height.
  //
  // Spacing inside the chapter is driven by the SubBlock component
  // (which carries its own top spacing). Direct cards (like the Ch. 4
  // DataSection that doesn't sit inside a SubBlock) get the same
  // 5/6 unit gap via space-y, applied at the wrapper level.
  return (
    <section
      id={`ch-${id}`}
      aria-labelledby={`ch-${id}-title`}
      className="scroll-mt-28 md:scroll-mt-12"
    >
      <ChapterHeading
        chapter={chapter}
        title={title}
        subtitle={subtitle}
        idAttr={`ch-${id}-title`}
        t={t}
      />
      <div className="space-y-7 md:space-y-9">{children}</div>
    </section>
  );
}

/**
 * 組 · Sub-block — visual sub-grouping inside a Chapter.
 *
 * Renders a small kanji-marked header above a stack of related cards.
 * The header is deliberately quieter than ChapterHeading: a 28px stamp
 * (vs the chapter's 56-64px hanko), a thin hairline divider that fades
 * into transparency on the right, and uppercase mono text instead of
 * the chapter's italic display face. The result is a clear "this is
 * a sub-grouping, not a new chapter" affordance — the eye tracks
 * chapter boundaries by the brushstroke + large hanko, sub-block
 * boundaries by the small kanji + hairline.
 *
 * Cards inside a sub-block get tighter vertical spacing than between
 * sub-blocks: closely related settings cluster, then a beat of breath
 * separates clusters.
 */
export function SubBlock({ block, children, t }) {
  // Outer wrapper is just animation + identity. The header gets its own
  // `mb-4` so the gap below it is tighter than the gap between cards
  // (5/6 via the inner space-y), which keeps the header visually
  // attached to "its" cards rather than floating equidistantly between
  // the previous block's last card and the next group.
  return (
    <div className="animate-fade-up">
      <div className="mb-4 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/70 bg-ink-2/50 font-jp text-[13px] font-bold leading-none text-hanko-bright shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
          style={{ transform: "rotate(-3deg)" }}
        >
          {block.kanji}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-washi-dim whitespace-nowrap">
          {t(block.labelKey)}
        </span>
        <span
          aria-hidden="true"
          className="h-px flex-1 bg-gradient-to-r from-border via-border/40 to-transparent"
        />
      </div>
      <div className="space-y-5 md:space-y-6">{children}</div>
    </div>
  );
}

function ChapterHeading({ chapter, title, subtitle, idAttr, t }) {
  return (
    <header className="mb-6 animate-fade-up md:mb-8">
      <div className="flex items-start gap-4 sm:gap-5">
        {/* 印 · Hanko-style chapter stamp. Stacked: ordinal on top
            (small), kanji on the bottom (large). Slight rotation +
            inset shadow give it a hand-pressed feel. */}
        <span
          className="chapter-stamp h-14 w-14 shrink-0 sm:h-16 sm:w-16"
          aria-hidden="true"
        >
          <span className="font-jp text-[9px] font-medium leading-none opacity-80 sm:text-[10px]">
            第{chapter.kanjiNum}章
          </span>
          <span className="mt-1 font-jp text-2xl font-bold leading-none sm:text-[28px]">
            {chapter.kanji}
          </span>
        </span>

        <div className="min-w-0 flex-1 pt-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-washi-dim">
            {t("settings.chapterLabel", { n: chapter.kanjiNum })}
          </p>
          <h2
            id={idAttr}
            className="mt-1 font-display text-2xl font-semibold italic leading-tight text-washi sm:text-3xl"
          >
            {title}
          </h2>
          <p className="mt-1 text-xs text-washi-muted sm:text-sm">{subtitle}</p>
        </div>
      </div>

      {/* Brushstroke divider — SVG path drawn left-to-right when the
          chapter scrolls into view. `viewBox=0 0 1200 8` gives an
          authentic taper at both ends. */}
      <svg
        viewBox="0 0 1200 8"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="mt-5 h-2 w-full"
      >
        <defs>
          <linearGradient id="brush-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--hanko)" stopOpacity="0" />
            <stop offset="14%" stopColor="var(--hanko)" stopOpacity="0.85" />
            <stop offset="50%" stopColor="var(--hanko-bright)" stopOpacity="1" />
            <stop offset="86%" stopColor="var(--hanko)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--hanko)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M2,4 Q200,1 400,4 T800,5 T1198,3"
          stroke="url(#brush-grad)"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          className="brushstroke-path"
        />
      </svg>
    </header>
  );
}
