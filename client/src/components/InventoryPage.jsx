import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import BarcodeScanner from "./BarcodeScanner.jsx";
import { useT, useLang } from "@/i18n/index.jsx";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";
import { useLocations } from "@/hooks/useLocations.js";
import {
  applyScan,
  buildSession,
  loadSession,
  missingCsv,
  saveSession,
  summarize,
  toggleSeen,
} from "@/lib/inventory.js";
import { formatShortDate } from "@/utils/date.js";

const KICKER =
  "font-mono text-[10px] uppercase tracking-[0.32em] text-washi-dim";
const BTN =
  "rounded-sm border border-border/70 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-washi-muted transition hover:border-gold/60 hover:text-washi disabled:cursor-not-allowed disabled:opacity-40";
const BTN_PRIMARY =
  "rounded-sm bg-hanko px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-on-hanko shadow-[0_0_24px_var(--hanko-glow)] transition hover:bg-hanko-deep disabled:cursor-not-allowed disabled:opacity-40";

/**
 * 棚卸 · Inventory — stock-taking by scanning spines. Pick a scope,
 * scan; what was never scanned is what is missing. Tomes without a
 * barcode are ticked by hand. The session survives a locked phone
 * (localStorage) and needs no network at all.
 */
export default function InventoryPage() {
  const t = useT();
  const lang = useLang();
  const routerLocation = useLocation();
  const { data: volumes } = useAllVolumes();
  const { data: library } = useLibrary();
  const { data: registry } = useLocations();

  const [saved] = useState(() => loadSession());
  const [session, setSession] = useState(null);
  const [phase, setPhase] = useState("scope"); // scope | scan | lists | done
  const handed = routerLocation.state?.scope;
  const [scopeKind, setScopeKind] = useState(handed?.kind ?? "all");
  const [scopeSeries, setScopeSeries] = useState(
    handed?.mal_id != null ? String(handed.mal_id) : "",
  );
  const [scopePlace, setScopePlace] = useState(handed?.name ?? "");
  const [seriesFilter, setSeriesFilter] = useState("");
  const [last, setLast] = useState(null);
  const [tab, setTab] = useState("missing");
  const [csvUrl, setCsvUrl] = useState(null);

  const persist = useCallback((next) => {
    setSession(next);
    saveSession(next);
  }, []);

  useEffect(() => () => csvUrl && URL.revokeObjectURL(csvUrl), [csvUrl]);

  const sortedLibrary = useMemo(
    () =>
      [...(library ?? [])]
        .filter(
          (s) =>
            !seriesFilter ||
            s.name?.toLowerCase().includes(seriesFilter.toLowerCase()),
        )
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [library, seriesFilter],
  );
  const placeNames = useMemo(() => {
    const names = new Set((registry ?? []).map((r) => r.name));
    for (const v of volumes ?? []) {
      const n = String(v.location ?? "").trim();
      if (n) names.add(n);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [registry, volumes]);

  const scopeLabel = (scope) => {
    if (scope?.kind === "series") {
      return (
        (library ?? []).find((s) => s.mal_id === scope.mal_id)?.name ??
        `#${scope.mal_id}`
      );
    }
    if (scope?.kind === "place") return scope.name;
    return t("inventory.scopeAll");
  };

  const start = () => {
    const scope =
      scopeKind === "series" && scopeSeries
        ? { kind: "series", mal_id: Number(scopeSeries) }
        : scopeKind === "place" && scopePlace
          ? { kind: "place", name: scopePlace }
          : { kind: "all" };
    persist(buildSession(scope, volumes ?? []));
    setLast(null);
    setPhase("scan");
  };

  const summary = useMemo(
    () => (session ? summarize(session, volumes ?? [], library ?? []) : null),
    [session, volumes, library],
  );

  const busyRef = useRef(false);
  const onDetect = useCallback(
    (raw) => {
      if (busyRef.current || !session) return;
      busyRef.current = true;
      const r = applyScan(session, raw, volumes ?? [], library ?? []);
      if (r.outcome !== "invalid") {
        try {
          navigator.vibrate?.(r.outcome === "present" ? 30 : [20, 40, 20]);
        } catch {
          /* ignore */
        }
      }
      if (r.session !== session) persist(r.session);
      setLast({
        outcome: r.outcome,
        label: r.volume
          ? `${r.series?.name ?? ""} #${r.volume.vol_num}`
          : (r.isbn ?? ""),
      });
      setTimeout(() => {
        busyRef.current = false;
      }, 700);
    },
    [session, volumes, library, persist],
  );

  const finish = () => {
    if (!session || !summary) return;
    const done = { ...session, finishedAt: new Date().toISOString() };
    persist(done);
    const blob = new Blob([missingCsv(summary)], {
      type: "text/csv;charset=utf-8",
    });
    setCsvUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(blob);
    });
    setPhase("done");
  };

  const reset = () => {
    persist(null);
    setLast(null);
    setPhase("scope");
  };

  const progress = summary
    ? `${summary.present.length} / ${summary.total}`
    : "";
  const pct =
    summary && summary.total
      ? Math.round((summary.present.length / summary.total) * 100)
      : 0;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pt-6 pb-32 md:pb-16">
      <header className="mb-8">
        <p className={KICKER}>{t("inventory.kicker")}</p>
        <h1 className="mt-2 font-display text-4xl font-light italic leading-tight text-washi md:text-5xl">
          {t("inventory.title")}
        </h1>
        <p className="mt-3 max-w-xl font-display text-lg font-light italic text-washi-muted">
          {t("inventory.subtitle")}
        </p>
      </header>

      {phase === "scope" && (
        <section className="space-y-6">
          {saved && !session && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-gold/40 bg-ink-1/40 px-4 py-3">
              <p className="font-display text-sm italic text-washi">
                {t("inventory.resume", {
                  scope: scopeLabel(saved.scope),
                  date: formatShortDate(saved.startedAt, lang),
                })}
              </p>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => saveSession(null) || reset()}
                  className={BTN}
                >
                  {t("inventory.discard")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSession(saved);
                    setPhase(saved.finishedAt ? "lists" : "scan");
                  }}
                  className={BTN_PRIMARY}
                >
                  {t("inventory.resumeButton")}
                </button>
              </div>
            </div>
          )}

          <fieldset className="rounded-md border border-border/70 bg-ink-1/30 p-5">
            <legend className={`${KICKER} px-2`}>
              {t("inventory.scopeLegend")}
            </legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              {["all", "series", "place"].map((kind) => (
                <label
                  key={kind}
                  className={`flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3 transition ${
                    scopeKind === kind
                      ? "border-gold/60 bg-ink-2/60"
                      : "border-border/60 hover:border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="scope"
                    value={kind}
                    checked={scopeKind === kind}
                    onChange={() => setScopeKind(kind)}
                    className="accent-[var(--hanko)]"
                  />
                  <span className="font-display text-base italic text-washi">
                    {t(`inventory.scope_${kind}`)}
                  </span>
                </label>
              ))}
            </div>
            {scopeKind === "series" && (
              <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_2fr]">
                <input
                  type="search"
                  value={seriesFilter}
                  onChange={(e) => setSeriesFilter(e.target.value)}
                  placeholder={t("inventory.filterSeries")}
                  aria-label={t("inventory.filterSeries")}
                  className="rounded-sm border border-border bg-ink-0/60 px-3 py-2 text-sm text-washi placeholder:text-washi-dim focus:border-gold/60 focus:outline-none"
                />
                <select
                  value={scopeSeries}
                  onChange={(e) => setScopeSeries(e.target.value)}
                  aria-label={t("inventory.pickSeries")}
                  className="rounded-sm border border-border bg-ink-0/60 px-3 py-2 font-display text-sm text-washi focus:border-gold/60 focus:outline-none"
                >
                  <option value="">{t("inventory.pickSeries")}</option>
                  {sortedLibrary.map((s) => (
                    <option key={s.mal_id} value={s.mal_id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {scopeKind === "place" && (
              <select
                value={scopePlace}
                onChange={(e) => setScopePlace(e.target.value)}
                aria-label={t("inventory.pickPlace")}
                className="mt-4 w-full rounded-sm border border-border bg-ink-0/60 px-3 py-2 font-display text-sm text-washi focus:border-gold/60 focus:outline-none sm:max-w-sm"
              >
                <option value="">{t("inventory.pickPlace")}</option>
                {placeNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            )}
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={start}
                disabled={
                  (scopeKind === "series" && !scopeSeries) ||
                  (scopeKind === "place" && !scopePlace)
                }
                className={BTN_PRIMARY}
              >
                {t("inventory.start")}
              </button>
            </div>
          </fieldset>
        </section>
      )}

      {phase === "scan" && session && (
        <>
          <BarcodeScanner
            onDetect={onDetect}
            onClose={() => setPhase("lists")}
            statusMessage={
              last
                ? t(`inventory.outcome_${last.outcome}`, { label: last.label })
                : t("inventory.pointCamera")
            }
            recentCount={summary?.present.length ?? 0}
          />
          {createPortal(
            <div
              role="status"
              className="fixed inset-x-3 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[2147483645] mx-auto max-w-lg rounded-2xl border border-border bg-ink-1/95 p-4 shadow-2xl backdrop-blur-xl md:bottom-8"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className={KICKER}>{scopeLabel(session.scope)}</span>
                <span className="font-mono text-sm tabular-nums text-washi">
                  {progress}
                </span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-3">
                <div
                  className="h-full bg-gold transition-[width]"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {last && (
                <p
                  className={`mt-3 truncate font-display text-base italic ${
                    last.outcome === "present"
                      ? "text-moegi"
                      : last.outcome === "repeat"
                        ? "text-washi-muted"
                        : "text-gold-muted"
                  }`}
                >
                  {t(`inventory.outcome_${last.outcome}`, {
                    label: last.label,
                  })}
                </p>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPhase("lists")}
                  className={BTN}
                >
                  {t("inventory.lists")}
                </button>
                <button type="button" onClick={finish} className={BTN_PRIMARY}>
                  {t("inventory.finish")}
                </button>
              </div>
            </div>,
            document.body,
          )}
        </>
      )}

      {(phase === "lists" || phase === "done") && session && summary && (
        <section className="space-y-5">
          <div className="rounded-md border border-border/70 bg-ink-1/30 p-5">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className={KICKER}>{scopeLabel(session.scope)}</span>
              <span className="font-mono text-sm tabular-nums text-washi">
                {progress}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-washi-dim">
                {t("inventory.progressWord")}
              </span>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-ink-3">
              <div className="h-full bg-gold" style={{ width: `${pct}%` }} />
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-4 font-mono text-[11px] uppercase tracking-[0.2em] text-washi-dim">
              <div>
                <dd className="font-display text-2xl italic normal-case tracking-normal text-moegi tabular-nums">
                  {summary.present.length}
                </dd>
                <dt>{t("inventory.present")}</dt>
              </div>
              <div>
                <dd className="font-display text-2xl italic normal-case tracking-normal text-hanko-bright tabular-nums">
                  {summary.missing.length}
                </dd>
                <dt>{t("inventory.missing")}</dt>
              </div>
              <div>
                <dd className="font-display text-2xl italic normal-case tracking-normal text-gold tabular-nums">
                  {summary.lent.length}
                </dd>
                <dt>{t("inventory.lent")}</dt>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {phase === "done" ? (
                <>
                  {csvUrl &&
                    (summary.missing.length > 0 || summary.lent.length > 0) && (
                      <a
                        href={csvUrl}
                        download="inventory-missing.csv"
                        className={BTN}
                      >
                        {t("inventory.exportCsv")}
                      </a>
                    )}
                  <button
                    type="button"
                    onClick={() => setPhase("scan")}
                    className={BTN}
                  >
                    {t("inventory.back")}
                  </button>
                  <button type="button" onClick={reset} className={BTN_PRIMARY}>
                    {t("inventory.again")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setPhase("scan")}
                    className={BTN}
                  >
                    {t("inventory.back")}
                  </button>
                  <button
                    type="button"
                    onClick={finish}
                    className={BTN_PRIMARY}
                  >
                    {t("inventory.finish")}
                  </button>
                </>
              )}
            </div>
          </div>

          <div role="tablist" className="flex gap-2">
            {[
              ["missing", summary.missing.length + summary.lent.length],
              ["present", summary.present.length],
              ["other", summary.unknown.length + summary.outside.length],
            ].map(([key, n]) => (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`${BTN} ${tab === key ? "border-gold/60 text-washi" : ""}`}
              >
                {t(`inventory.tab_${key}`)} · {n}
              </button>
            ))}
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-washi-dim">
            {t("inventory.tapHint")}
          </p>

          {tab === "other" ? (
            <div className="space-y-4">
              <TomeList
                title={t("inventory.outsideTitle")}
                rows={summary.outside}
                t={t}
                empty={t("inventory.nothingHere")}
              />
              <div>
                <h3 className={KICKER}>{t("inventory.unknownTitle")}</h3>
                {summary.unknown.length === 0 ? (
                  <p className="mt-2 font-display text-sm italic text-washi-dim">
                    {t("inventory.nothingHere")}
                  </p>
                ) : (
                  <ul role="list" className="mt-2 flex flex-wrap gap-2">
                    {summary.unknown.map((isbn) => (
                      <li
                        key={isbn}
                        className="rounded-sm border border-border/70 px-2 py-1 font-mono text-xs text-washi-muted"
                      >
                        {isbn}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <TomeList
              rows={
                tab === "missing"
                  ? [...summary.missing, ...summary.lent]
                  : summary.present
              }
              t={t}
              empty={t("inventory.nothingHere")}
              onToggle={(id) => persist(toggleSeen(session, id))}
              ticked={tab === "present"}
            />
          )}
        </section>
      )}
    </div>
  );
}

function TomeList({ title, rows, t, empty, onToggle, ticked = false }) {
  return (
    <div>
      {title && <h3 className={KICKER}>{title}</h3>}
      {rows.length === 0 ? (
        <p className="mt-2 font-display text-sm italic text-washi-dim">
          {empty}
        </p>
      ) : (
        <ul
          role="list"
          className="mt-2 divide-y divide-border/60 rounded-md border border-border/70 bg-ink-1/30"
        >
          {rows.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                disabled={!onToggle}
                onClick={() => onToggle?.(v.id)}
                aria-pressed={ticked}
                className="flex w-full items-baseline gap-3 px-4 py-2 text-left transition hover:bg-ink-2/40 disabled:cursor-default"
              >
                <span
                  aria-hidden="true"
                  className={`font-jp text-sm ${ticked ? "text-moegi" : v.loaned_to ? "text-gold" : "text-hanko-bright"}`}
                >
                  {ticked ? "済" : v.loaned_to ? "貸" : "欠"}
                </span>
                <span className="min-w-0 flex-1 truncate font-display text-base italic text-washi">
                  {v.series_name}
                  <span className="ml-1.5 font-mono text-[11px] not-italic tabular-nums text-gold">
                    #{v.vol_num}
                  </span>
                </span>
                {v.location && (
                  <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-washi-dim sm:inline">
                    {v.location}
                  </span>
                )}
                {v.loaned_to && (
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-gold-muted">
                    {t("inventory.lentHint", { name: v.loaned_to })}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
