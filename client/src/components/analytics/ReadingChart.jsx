import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Skeleton from "../ui/Skeleton.jsx";
import { useT } from "@/i18n/index.jsx";

/**
 * Reading cadence — monthly histogram of `read_at` timestamps.
 *
 * Siblings of SpendingChart both visually and in intent: same card
 * chrome, same 12-month window, but the bars are rendered in moegi
 * (jade "cultivated" colour) rather than hanko red. Header shows four
 * roll-ups: volumes read, read ratio, fully-read series, and tsundoku
 * count (the counter-weight: how much is owned but waiting to be read).
 */
export default function ReadingChart({ reading, loading }) {
  const t = useT();

  const data = reading?.monthlyReads ?? [];
  const volumesRead = reading?.volumesRead ?? 0;
  const tsundokuCount = reading?.tsundokuCount ?? 0;
  const fullyReadSeries = reading?.fullyReadSeries ?? 0;
  const readRatio = reading?.readRatio ?? 0;

  const maxCount = Math.max(...data.map((d) => d.count), 0);
  const totalReads = data.reduce((s, d) => s + d.count, 0);
  const activeMonths = data.filter((d) => d.count > 0).length;
  const avgPerActive = activeMonths > 0 ? totalReads / activeMonths : 0;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
        {t("analytics.reading.label")}
      </p>
      <div className="mt-1 flex items-baseline gap-3">
        <h2 className="font-display text-xl font-semibold text-washi">
          {t("analytics.reading.title")}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-washi-muted">
          {t("analytics.reading.last12")}
        </span>
      </div>

      {/* Four-up quick stats row — echoes the Dashboard StatChips style. */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Chip
          label={t("analytics.reading.totalRead")}
          value={loading ? <Skeleton.Stat width="4ch" /> : volumesRead}
          accent="moegi"
        />
        <Chip
          label={t("analytics.reading.ratio")}
          value={
            loading ? (
              <Skeleton.Stat width="4ch" />
            ) : (
              `${Math.round(readRatio)}%`
            )
          }
          accent="moegi"
        />
        <Chip
          label={t("analytics.reading.fullyRead")}
          value={loading ? <Skeleton.Stat width="3ch" /> : fullyReadSeries}
          accent="gold"
        />
        <Chip
          label={t("analytics.reading.tsundoku")}
          value={loading ? <Skeleton.Stat width="3ch" /> : tsundokuCount}
          accent="washi"
          hint="積読"
        />
      </div>

      {/* Cadence summary — avg reads/active month */}
      {!loading && totalReads > 0 && (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
          {t("analytics.reading.avgActive", {
            n: Math.round(avgPerActive * 10) / 10,
          })}
        </p>
      )}

      {/* Bar chart — moegi gradient bars, taller month highlighted gold */}
      <div className="mt-5 h-48 w-full">
        {loading ? (
          <Skeleton.Bars count={12} />
        ) : totalReads === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 bg-ink-1/30 px-4 py-6 text-center">
            <p className="font-jp text-2xl text-washi-dim">読</p>
            <p className="font-display text-sm italic text-washi-muted">
              {t("analytics.reading.emptyTitle")}
            </p>
            <p className="max-w-xs text-[11px] text-washi-dim">
              {t("analytics.reading.emptyBody")}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="readBar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--moegi)" stopOpacity={1} />
                  <stop
                    offset="100%"
                    stopColor="var(--moegi-muted)"
                    stopOpacity={0.9}
                  />
                </linearGradient>
                <linearGradient id="readBarPeak" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--gold)" stopOpacity={1} />
                  <stop
                    offset="100%"
                    stopColor="var(--gold-muted)"
                    stopOpacity={0.9}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke="var(--border)"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                stroke="var(--washi-dim)"
                tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                stroke="var(--washi-dim)"
                tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: "var(--ink-2)", opacity: 0.4 }}
                contentStyle={{
                  background: "var(--ink-1)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                }}
                labelStyle={{ color: "var(--washi)" }}
                itemStyle={{ color: "var(--moegi)" }}
                formatter={(v) => [v, t("analytics.reading.tooltip")]}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {data.map((d) => (
                  <Cell
                    key={d.month}
                    fill={
                      d.count === maxCount && maxCount > 0
                        ? "url(#readBarPeak)"
                        : "url(#readBar)"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function Chip({ label, value, accent = "washi", hint }) {
  const accentClass =
    accent === "moegi"
      ? "text-moegi"
      : accent === "gold"
        ? "text-gold"
        : accent === "hanko"
          ? "text-hanko-bright"
          : "text-washi";
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-ink-1/60 p-3 backdrop-blur transition hover:border-moegi/30">
      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-washi-dim">
        {label}
      </p>
      <p
        className={`mt-1 font-display text-xl font-semibold tabular-nums ${accentClass}`}
      >
        {value}
      </p>
      {hint && (
        <p className="font-jp text-[9px] text-washi-dim">{hint}</p>
      )}
    </div>
  );
}
