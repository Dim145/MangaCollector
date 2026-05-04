/**
 * 銭 · Trésor — the high-value items rail.
 *
 * Two pieces:
 *   - TopTomeCard — the single most expensive owned volume,
 *     rendered as a poster + price stamp.
 *   - BasketEvolution — 12-month sparkline of the average price
 *     of newly-added volumes. Reads as a "is your basket getting
 *     more expensive?" line.
 */
import { Link } from "react-router-dom";
import CoverImage from "../ui/CoverImage.jsx";
import StatLedgerCard from "./StatLedgerCard.jsx";
import { formatCurrency } from "@/utils/price.js";

export default function TreasureGrid({
  topVolumePrices,
  basketEvolution,
  currency,
  t,
  loading,
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-6">
      <TopTomeCard
        top={topVolumePrices?.[0]}
        currency={currency}
        t={t}
        loading={loading}
      />
      <BasketEvolution
        data={basketEvolution}
        currency={currency}
        t={t}
        loading={loading}
      />
    </div>
  );
}

function TopTomeCard({ top, currency, t, loading }) {
  if (loading) {
    return (
      <div className="h-72 animate-pulse rounded-2xl border border-border/60 bg-ink-1/40" />
    );
  }
  if (!top) {
    return (
      <p className="rounded-2xl border border-dashed border-border/70 bg-ink-1/30 px-6 py-10 text-center font-display italic text-washi-muted">
        {t("stats.treasure.topEmpty")}
      </p>
    );
  }

  return (
    <Link
      to={`/mangapage?mal_id=${top.mal_id}`}
      className="group relative isolate flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-ink-1/55 backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[color:var(--folio-accent,var(--sakura))]/55 hover:shadow-[0_22px_36px_-22px_color-mix(in_oklab,var(--folio-accent,var(--sakura))_55%,transparent)]"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-ink-2/60">
        {top.image_url ? (
          <CoverImage
            src={top.image_url}
            alt=""
            className="h-full w-full object-cover opacity-85 transition group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-jp text-7xl font-bold text-sakura/30">
            銭
          </div>
        )}
        {/* gradient floor */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink-1/95 via-ink-1/80 to-transparent"
        />

        {/* Hanko-style price stamp, rotated. */}
        <span
          aria-hidden="true"
          className="absolute bottom-3 right-3 inline-flex items-baseline gap-1 rounded-md border border-hanko/70 bg-hanko/85 px-3 py-1 font-display text-xl italic text-washi shadow-[0_6px_18px_-6px_rgba(0,0,0,0.6)]"
          style={{ transform: "rotate(-3deg)" }}
        >
          {formatCurrency(top.price, currency)}
        </span>
      </div>

      <div className="relative flex flex-1 flex-col gap-2 p-5 md:p-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-washi-muted">
          {t("stats.treasure.topEyebrow")}
        </p>
        <h3 className="font-display text-xl font-light italic leading-tight text-washi md:text-2xl">
          {top.series_name}
        </h3>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-washi-dim">
          {t("stats.treasure.volNum", { n: top.vol_num })}
          {top.store ? ` · ${top.store}` : ""}
          {top.collector ? ` · ${t("stats.treasure.collector")}` : ""}
        </p>
      </div>
    </Link>
  );
}

function BasketEvolution({ data, currency, t, loading }) {
  if (loading) {
    return (
      <div className="h-72 animate-pulse rounded-2xl border border-border/60 bg-ink-1/40" />
    );
  }
  const samples = (data ?? []).filter((b) => b.count > 0);
  if (samples.length === 0) {
    return (
      <StatLedgerCard
        kanji="籠"
        eyebrow={t("stats.treasure.basketEyebrow")}
        value="—"
        hint={t("stats.treasure.basketEmpty")}
        loading={false}
      />
    );
  }

  // Compute mini-line geometry. Plain SVG — no recharts needed,
  // saves a chunk on this section's bundle.
  const max = Math.max(...samples.map((s) => s.avg));
  const min = Math.min(...samples.map((s) => s.avg));
  const range = Math.max(0.01, max - min);
  const W = 320;
  const H = 80;
  const stepX = data.length > 1 ? W / (data.length - 1) : 0;
  const points = data.map((b, i) => {
    if (b.count === 0) return null;
    const x = i * stepX;
    const y = H - ((b.avg - min) / range) * H;
    return { x, y, value: b.avg, label: b.label };
  });
  // Convert to SVG path, leaving gaps for empty months.
  let path = "";
  let lastValid = false;
  points.forEach((p) => {
    if (!p) {
      lastValid = false;
      return;
    }
    path += `${lastValid ? "L" : "M"} ${p.x.toFixed(2)} ${p.y.toFixed(2)} `;
    lastValid = true;
  });
  const lastSampled = samples[samples.length - 1];

  return (
    <article className="group relative isolate flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-ink-1/55 px-5 py-5 backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-[color:var(--folio-accent,var(--sakura))]/55 md:px-6 md:py-6">
      <span
        aria-hidden="true"
        className="absolute right-3 top-3 select-none font-jp text-3xl font-bold leading-none"
        style={{
          color: "var(--folio-accent, var(--sakura))",
          opacity: 0.32,
          transform: "rotate(-5deg)",
        }}
      >
        籠
      </span>

      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-washi-muted">
        {t("stats.treasure.basketEyebrow")}
      </p>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-display text-3xl font-light italic leading-none tracking-tight text-washi md:text-4xl">
          {formatCurrency(lastSampled.avg, currency)}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-washi-muted">
          {lastSampled.label}
        </span>
      </div>

      <p className="mt-1 font-display text-[12px] italic text-washi-muted md:text-[13px]">
        {t("stats.treasure.basketHint")}
      </p>

      <svg
        className="mt-5 h-20 w-full"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="basket-fill" x1="0" x2="0" y1="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--folio-accent, var(--sakura))"
              stopOpacity="0.45"
            />
            <stop
              offset="100%"
              stopColor="var(--folio-accent, var(--sakura))"
              stopOpacity="0"
            />
          </linearGradient>
        </defs>
        {/* Filled area beneath the line */}
        {path ? (
          <path
            d={`${path} L ${W} ${H} L 0 ${H} Z`}
            fill="url(#basket-fill)"
            opacity="0.6"
          />
        ) : null}
        {/* The line itself */}
        {path ? (
          <path
            d={path}
            stroke="var(--folio-accent, var(--sakura))"
            strokeWidth="1.6"
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {/* Latest dot */}
        {(() => {
          const last = points.filter(Boolean).pop();
          if (!last) return null;
          return (
            <circle
              cx={last.x}
              cy={last.y}
              r="3"
              fill="var(--folio-accent, var(--sakura))"
            />
          );
        })()}
      </svg>

      {/* Month labels — thin row, every 3rd to avoid clutter. */}
      <div className="mt-1 flex justify-between font-mono text-[9px] tabular-nums text-washi-dim">
        {data
          .filter((_, i) => i % 3 === 0)
          .map((b) => (
            <span key={b.key}>{b.label}</span>
          ))}
      </div>
    </article>
  );
}
