/**
 * 版 · Top éditeurs — horizontal bar list.
 *
 * Each row shows the publisher name, owned-volume count, an
 * inline progress bar for completion %, and a chip for the
 * series count. Bar widths are normalised to the leader so the
 * eye reads a podium even when the absolute counts are close.
 *
 * Rows are not interactive yet — there's no per-publisher page.
 * If one ever lands, swap the outer wrapper for a Link.
 */
export default function PublishersRail({ publishers, t, loading }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-xl border border-border/60 bg-ink-1/40"
          />
        ))}
      </div>
    );
  }

  if (!publishers?.length) {
    return (
      <p className="rounded-2xl border border-dashed border-border/70 bg-ink-1/30 px-6 py-10 text-center font-display italic text-washi-muted">
        {t("stats.publishers.empty")}
      </p>
    );
  }

  const leader = publishers[0]?.ownedVolumes || 1;

  return (
    <ol className="flex flex-col gap-2.5">
      {publishers.map((p, i) => (
        <li key={p.name}>
          <Row publisher={p} leader={leader} rank={i + 1} t={t} />
        </li>
      ))}
    </ol>
  );
}

function Row({ publisher, leader, rank, t }) {
  const { name, ownedVolumes, seriesCount, completionPct } = publisher;
  const widthPct = Math.max(6, Math.round((ownedVolumes / leader) * 100));

  return (
    <article className="group relative isolate overflow-hidden rounded-xl border border-border/60 bg-ink-1/40 px-4 py-3 transition hover:border-[color:var(--folio-accent,var(--gold))]/55 hover:bg-ink-1/55 md:px-5">
      {/* Filled bar — proportional to the leader. Sits behind
          the text for a "filling-up" feel. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 -z-10 transition-[width] duration-700 ease-out"
        style={{
          width: `${widthPct}%`,
          background:
            "linear-gradient(90deg, color-mix(in oklab, var(--folio-accent, var(--gold)) 18%, transparent) 0%, color-mix(in oklab, var(--folio-accent, var(--gold)) 4%, transparent) 100%)",
        }}
      />

      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="font-mono text-[10px] tabular-nums text-washi-dim"
        >
          {String(rank).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2">
            <span className="truncate font-display text-base italic text-washi md:text-lg">
              {name}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
              {seriesCount} {t("stats.publishers.seriesShort")}
            </span>
          </p>
        </div>

        <div className="flex shrink-0 items-baseline gap-3 text-right">
          <span className="font-display text-xl font-light italic tabular-nums text-washi md:text-2xl">
            {ownedVolumes}
            <span className="ml-0.5 font-jp text-[12px] font-bold not-italic text-washi-muted md:text-sm">
              巻
            </span>
          </span>
          <span
            className="font-mono text-[11px] tabular-nums"
            style={{ color: "var(--folio-accent, var(--gold))" }}
          >
            {completionPct}%
          </span>
        </div>
      </div>
    </article>
  );
}
