import { useContext } from "react";
import Skeleton from "../ui/Skeleton.jsx";
import SettingsContext from "@/SettingsContext.js";
import { formatCurrency } from "@/utils/price.js";
import { useT } from "@/i18n/index.jsx";

/**
 * Three compact stat panels laid out in a 3-col grid:
 *   1. Collector insights — ratio + premium paid vs standard
 *   2. Coffret savings — estimated money saved by buying box-sets
 *   3. Next milestone — progress bar toward the next volume-count jalon
 *
 * Each card has a distinctive accent so the user can scan the row and pick
 * the interesting one by colour alone.
 */
export default function InsightCards({ collector, coffret, milestones, loading }) {
  const t = useT();

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <CollectorCard collector={collector} loading={loading} t={t} />
      <CoffretCard coffret={coffret} loading={loading} t={t} />
      <MilestoneCard milestones={milestones} loading={loading} t={t} />
    </div>
  );
}

/* ─────────────────────────── Collector ─────────────────────────── */

function CollectorCard({ collector, loading, t }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-gold/25 bg-gradient-to-br from-gold/[0.05] via-ink-1/40 to-ink-1/40 p-5 backdrop-blur transition hover:border-gold/50">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-6 -right-6 grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-gold/20 to-transparent blur-xl"
      />
      <div className="relative flex items-baseline gap-2">
        <span
          aria-hidden="true"
          className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-gold to-gold-muted text-ink-0 shadow-[0_1px_4px_rgba(201,169,97,0.6)]"
          style={{ transform: "rotate(-4deg)" }}
        >
          <span className="font-display text-[11px] font-bold leading-none">
            限
          </span>
        </span>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
          {t("analytics.collector.label")}
        </p>
      </div>
      <h3 className="mt-1 font-display text-base font-semibold italic text-washi">
        {t("analytics.collector.title")}
      </h3>
      {loading ? (
        <Skeleton className="mt-4 h-8 w-32" />
      ) : (
        <div className="mt-3 space-y-2">
          <div>
            <p className="font-display text-3xl font-semibold tabular-nums text-gold">
              {collector.count}
              <span className="ml-2 font-mono text-sm font-normal text-washi-dim">
                {t("analytics.collector.volumes")}
              </span>
            </p>
            <p className="mt-0.5 text-[11px] text-washi-muted">
              {t("analytics.collector.ratio", {
                pct: collector.ratio.toFixed(1),
              })}
            </p>
          </div>
          {collector.premiumPct != null && collector.count > 0 && (
            <div className="border-t border-border/50 pt-2">
              <p className="font-mono text-[9px] uppercase tracking-wider text-washi-dim">
                {t("analytics.collector.premiumLabel")}
              </p>
              <p className="font-display text-lg font-semibold tabular-nums text-washi">
                {collector.premiumPct >= 0 ? "+" : ""}
                {collector.premiumPct.toFixed(0)}%
              </p>
              <p className="text-[10px] text-washi-muted">
                {t("analytics.collector.premiumHint")}
              </p>
            </div>
          )}
          {collector.count === 0 && (
            <p className="text-xs text-washi-muted">
              {t("analytics.collector.empty")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Coffret ─────────────────────────── */

function CoffretCard({ coffret, loading, t }) {
  const { currency: currencySetting } = useContext(SettingsContext);

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-washi/15 bg-gradient-to-br from-ink-2/50 via-ink-1/40 to-ink-1/30 p-5 backdrop-blur transition hover:border-washi/30">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-washi/40 to-transparent"
      />
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden="true"
          className="grid h-6 w-6 place-items-center rounded-md bg-washi text-ink-0 shadow-[0_1px_4px_rgba(10,9,8,0.4)]"
          style={{ transform: "rotate(-4deg)" }}
        >
          <span className="font-display text-[11px] font-bold leading-none">
            盒
          </span>
        </span>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-muted">
          {t("analytics.coffret.label")}
        </p>
      </div>
      <h3 className="mt-1 font-display text-base font-semibold italic text-washi">
        {t("analytics.coffret.title")}
      </h3>
      {loading ? (
        <Skeleton className="mt-4 h-8 w-32" />
      ) : coffret.distinctCount === 0 ? (
        <p className="mt-3 text-sm text-washi-muted">
          {t("analytics.coffret.empty")}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <div>
            <p className="font-display text-3xl font-semibold tabular-nums text-washi">
              {formatCurrency(coffret.savingsTotal, currencySetting)}
            </p>
            <p className="mt-0.5 text-[11px] text-washi-muted">
              {t("analytics.coffret.savingsHint")}
            </p>
          </div>
          <div className="border-t border-washi/10 pt-2 text-[11px] text-washi-muted">
            <p>
              <span className="font-semibold text-washi">
                {coffret.distinctCount}
              </span>{" "}
              {t("analytics.coffret.coffretsCount", { n: coffret.distinctCount })}{" "}
              •{" "}
              <span className="font-semibold text-washi">
                {coffret.volumeCount}
              </span>{" "}
              {t("analytics.coffret.volumesIn")}
            </p>
            {coffret.savingsPerVol > 0 && (
              <p className="mt-0.5">
                {t("analytics.coffret.perVol", {
                  amount: formatCurrency(coffret.savingsPerVol, currencySetting),
                })}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Milestone ─────────────────────────── */

function MilestoneCard({ milestones, loading, t }) {
  const next = milestones.nextVolume;
  const current = milestones.ownedVolumeCount;
  const pct = next ? Math.min(100, (current / next) * 100) : 100;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-hanko/25 bg-gradient-to-br from-hanko/[0.05] via-ink-1/40 to-ink-1/40 p-5 backdrop-blur transition hover:border-hanko/50">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-10 -left-10 h-32 w-32 rounded-full bg-hanko/10 blur-3xl"
      />
      <div className="relative flex items-baseline gap-2">
        <span
          aria-hidden="true"
          className="grid h-6 w-6 place-items-center rounded-md bg-hanko text-washi shadow-md glow-red"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <path d="M12 2l2.5 6.5L21 9l-5 4.8L17.5 21 12 17.5 6.5 21l1.5-7.2L3 9l6.5-.5L12 2z" />
          </svg>
        </span>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-hanko-bright">
          {t("analytics.milestone.label")}
        </p>
      </div>
      <h3 className="mt-1 font-display text-base font-semibold italic text-washi">
        {t("analytics.milestone.title")}
      </h3>

      {loading ? (
        <Skeleton className="mt-4 h-8 w-32" />
      ) : next == null ? (
        <p className="mt-3 text-sm text-washi-muted">
          {t("analytics.milestone.maxed")}
        </p>
      ) : (
        <div className="relative mt-3 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-display text-3xl font-semibold tabular-nums text-washi">
              {current}
              <span className="mx-1 text-washi-dim">/</span>
              <span className="text-hanko-bright">{next}</span>
            </p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-washi-muted">
              {Math.max(0, next - current)} {t("analytics.milestone.toGo")}
            </p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-2">
            <div
              className="h-full rounded-full bg-gradient-to-r from-hanko to-hanko-bright transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[11px] text-washi-muted">
            {t("analytics.milestone.hint", { n: next })}
          </p>
        </div>
      )}
    </div>
  );
}
