/**
 * 読 · Reading-pace triad — the two new reading-tier stats
 * presented side-by-side as ledger cards.
 *
 *   - Délai moyen achat → lecture (avg days)
 *   - Dokuha ratio (series fully read / fully owned)
 *
 * Both share the same moegi accent inherited from the parent
 * folio. The cards stand on their own; the ReadingChart that
 * already exists slots above them in the StatsPage layout.
 */
import StatLedgerCard from "./StatLedgerCard.jsx";

export default function ReadingPaceTriad({ delay, dokuha, t, loading }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <StatLedgerCard
        kanji="間"
        eyebrow={t("stats.reading.delayEyebrow")}
        value={
          loading
            ? "—"
            : delay?.avgDays != null
              ? t("stats.reading.delayDays", { n: delay.avgDays })
              : t("stats.reading.delayEmpty")
        }
        sub={
          loading
            ? null
            : delay?.samples
              ? t("stats.reading.delaySamples", { n: delay.samples })
              : null
        }
        hint={t("stats.reading.delayHint")}
        loading={loading}
      />

      <StatLedgerCard
        kanji="読破"
        eyebrow={t("stats.reading.dokuhaEyebrow")}
        value={loading ? "—" : `${dokuha?.pct ?? 0}%`}
        sub={
          loading
            ? null
            : t("stats.reading.dokuhaCounts", {
                read: dokuha?.read ?? 0,
                total: dokuha?.total ?? 0,
              })
        }
        hint={t("stats.reading.dokuhaHint")}
        loading={loading}
      >
        {!loading ? <DokuhaBar pct={dokuha?.pct ?? 0} /> : null}
      </StatLedgerCard>
    </div>
  );
}

function DokuhaBar({ pct }) {
  const clamped = Math.min(100, Math.max(0, Math.round(pct)));
  return (
    <div className="relative h-2 overflow-hidden rounded-full bg-ink-2/60">
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{
          width: `${clamped}%`,
          background:
            "linear-gradient(90deg, var(--folio-accent, var(--moegi)) 0%, color-mix(in oklab, var(--folio-accent, var(--moegi)) 60%, white) 100%)",
        }}
      />
    </div>
  );
}
