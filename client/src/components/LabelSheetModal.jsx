import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap.js";
import { useT } from "@/i18n/index.jsx";
import {
  DEFAULT_TEMPLATE_ID,
  LABEL_TEMPLATES,
  buildLabelPdf,
  pageSize,
  perPage,
  sheetOccupancy,
  summarizeLabels,
} from "@/lib/labels.js";

/**
 * 札 Fuda · Label-sheet printer.
 *
 * Takes ready-made labels (`tomeLabels` / `boxLabel` from lib/labels)
 * and turns them into a PDF laid out on an Avery sheet: pick the
 * sheet, say where to start on a partly used one, watch the grid fill
 * in, generate. The PDF opens in a new tab and is offered as a
 * download link — object URLs are released when the modal closes.
 *
 * Aesthetic — the same circulation-slip vocabulary as LoanModal
 * (paper grain, mono kickers, italic display heading, a hanko pressed
 * into the corner), with a miniature sheet standing in for the form's
 * second column: a paper-white card at the page's aspect ratio whose
 * cells are the labels, filled in hanko red where a sticker will land.
 * Clicking a cell moves the start position there.
 *
 * Self-contained portal rather than `ui/Modal.jsx`: that wrapper puts
 * `role="dialog"` on its overlay with no way to name it, and this
 * dialog needs `aria-labelledby` on the element that carries the role.
 * The focus trap, scroll lock and Escape handling are the shared
 * `useFocusTrap`, exactly as Modal wires them.
 */
export default function LabelSheetModal({
  open,
  onClose,
  labels,
  title,
  subtitle,
}) {
  const t = useT();
  const list = useMemo(() => (Array.isArray(labels) ? labels : []), [labels]);

  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  // Raw field text; the clamped integer is derived below so the user
  // can clear the box and type without the value snapping back mid-key.
  const [startInput, setStartInput] = useState("0");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [blobUrl, setBlobUrl] = useState(null);

  const rootRef = useRef(null);
  useFocusTrap(open, rootRef, onClose);

  const template =
    LABEL_TEMPLATES[templateId] ?? LABEL_TEMPLATES[DEFAULT_TEMPLATE_ID];
  const page = pageSize(template);
  const slots = perPage(template);
  const startAt = clampInt(startInput, 0, slots - 1);

  const summary = useMemo(
    () => summarizeLabels(list, template, startAt),
    [list, template, startAt],
  );
  const cells = useMemo(
    () => sheetOccupancy(list.length, template, startAt, 0),
    [list.length, template, startAt],
  );
  const overflow = Math.max(0, startAt + list.length - slots);

  // Fresh transient state on close. Dropping `blobUrl` lets the
  // cleanup below revoke the object URL.
  useEffect(() => {
    if (open) return;
    setBusy(false);
    setProgress(null);
    setError(null);
    setBlobUrl(null);
  }, [open]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  async function handleGenerate() {
    if (busy || !list.length) return;
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: list.length });
    try {
      const blob = await buildLabelPdf(list, {
        template,
        startAt,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
      try {
        // Best effort: the user gesture is usually spent by the time
        // rendering ends, so a blocker may swallow this. The download
        // link below is the reliable path either way.
        window.open(url, "_blank", "noopener");
      } catch {
        /* popup blocked — the link still works */
      }
    } catch (err) {
      console.error("[labels] PDF build failed", err);
      setError(err);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const heading = title || t("labels.title");
  const gridW =
    template.cols * template.labelW + (template.cols - 1) * template.gapX;
  const gridH =
    template.rows * template.labelH + (template.rows - 1) * template.gapY;
  const marginRight = page.w - template.marginLeft - gridW;
  const marginBottom = page.h - template.marginTop - gridH;
  // CSS percentage padding resolves against the box width on every
  // side, so all four margins are expressed as a share of the sheet
  // width.
  const pct = (mm) => `${((mm / page.w) * 100).toFixed(3)}%`;

  const overlay = (
    <div
      className="fixed inset-0 flex items-center justify-center bg-ink-0/80 p-4 backdrop-blur-md animate-fade-in"
      style={{ zIndex: 2147483630 }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        onClose?.();
      }}
    >
      <div className="relative max-h-[calc(100dvh_-_2rem)] w-full max-w-lg overflow-auto animate-fade-up">
        <div
          ref={rootRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={TITLE_ID}
          tabIndex={-1}
          className="fuda-modal relative overflow-hidden rounded-md border border-border bg-ink-1 shadow-2xl focus:outline-none"
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay"
            style={{ backgroundImage: PAPER_GRAIN }}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-hanko/70 to-transparent"
          />

          <header className="relative border-b border-border/70 px-6 pt-5 pb-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-hanko-bright">
                {t("labels.kicker")}
                {" · "}
                <span className="font-jp text-[12px]">札</span>
              </p>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-ink-0/60 text-washi-muted transition hover:border-hanko hover:bg-hanko hover:text-on-hanko"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <h2
              id={TITLE_ID}
              className="mt-2 font-display text-xl font-light italic leading-tight text-washi"
            >
              {heading}
            </h2>
            {subtitle ? (
              <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
                {subtitle}
              </p>
            ) : null}
          </header>

          <div className="relative space-y-5 px-6 py-5">
            <div>
              <label
                htmlFor={TEMPLATE_ID}
                className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.28em] text-washi-dim"
              >
                {t("labels.template")} · 型
              </label>
              <select
                id={TEMPLATE_ID}
                data-autofocus
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="w-full rounded-md border border-border bg-ink-0/60 px-3 py-2.5 font-mono text-sm text-washi transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
              >
                {Object.values(LABEL_TEMPLATES).map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {`${tpl.name} · ${tpl.cols}×${tpl.rows} · ${mm(tpl.labelW)}×${mm(tpl.labelH)} mm · ${
                      tpl.page === "letter"
                        ? t("labels.pageLetter")
                        : t("labels.pageA4")
                    }`}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 font-mono text-[10px] tracking-[0.18em] text-washi-dim">
                {t("labels.templateHint")}
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <div className="min-w-0">
                <label
                  htmlFor={START_ID}
                  className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.28em] text-washi-dim"
                >
                  {t("labels.startAt")} · 位
                </label>
                <input
                  id={START_ID}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={slots - 1}
                  step={1}
                  value={startInput}
                  onChange={(e) => setStartInput(e.target.value)}
                  onBlur={() => setStartInput(String(startAt))}
                  className="w-full rounded-md border border-border bg-ink-0/60 px-3 py-2.5 font-mono text-sm tabular-nums text-washi transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
                />
                <p className="mt-1.5 font-mono text-[10px] tracking-[0.18em] text-washi-dim">
                  {t("labels.startAtHint", { max: slots - 1 })}
                </p>

                <div className="mt-4 space-y-1.5">
                  {list.length ? (
                    <p className="font-mono text-[11px] tracking-[0.14em] text-washi">
                      {t("labels.summary", {
                        n: summary.count,
                        pages: summary.pages,
                        missing: summary.withoutBarcode,
                      })}
                    </p>
                  ) : (
                    <p className="font-mono text-[11px] tracking-[0.14em] text-washi-muted">
                      {t("labels.empty")}
                    </p>
                  )}
                  {overflow > 0 ? (
                    <p className="font-mono text-[10px] tracking-[0.18em] text-gold">
                      {t("labels.overflow", { n: overflow })}
                    </p>
                  ) : null}
                  {summary.withoutBarcode > 0 ? (
                    <p className="font-mono text-[10px] tracking-[0.18em] text-washi-dim">
                      {t("labels.noBarcodeHint")}
                    </p>
                  ) : null}
                </div>
              </div>

              <div>
                <p className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.28em] text-washi-dim">
                  {t("labels.preview")} · 頁
                </p>
                <div
                  role="group"
                  aria-label={t("labels.preview")}
                  className="mx-auto w-40 rounded-[2px] bg-washi shadow-[0_10px_24px_-12px_rgba(0,0,0,0.85)] ring-1 ring-ink-0/25 sm:w-full"
                  style={{
                    aspectRatio: `${page.w} / ${page.h}`,
                    padding: `${pct(template.marginTop)} ${pct(marginRight)} ${pct(marginBottom)} ${pct(template.marginLeft)}`,
                  }}
                >
                  <div
                    className="grid h-full w-full"
                    style={{
                      gridTemplateColumns: `repeat(${template.cols}, minmax(0, 1fr))`,
                      gridTemplateRows: `repeat(${template.rows}, minmax(0, 1fr))`,
                      gap: "2px",
                    }}
                  >
                    {cells.map((state, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setStartInput(String(i))}
                        aria-label={t("labels.startHere", { n: i })}
                        aria-pressed={i === startAt}
                        className={`min-h-0 min-w-0 rounded-[1px] transition ${
                          state === "used"
                            ? "bg-hanko hover:bg-hanko-deep"
                            : state === "skipped"
                              ? "bg-ink-0/25 hover:bg-ink-0/40"
                              : "bg-ink-0/[0.06] hover:bg-ink-0/20"
                        } ${i === startAt ? "ring-1 ring-gold" : ""}`}
                      />
                    ))}
                  </div>
                </div>
                <p className="mt-1.5 text-center font-mono text-[10px] tracking-[0.18em] text-washi-dim">
                  {t("labels.previewPage", {
                    pages: Math.max(1, summary.pages),
                  })}
                </p>
              </div>
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-md border border-hanko/40 bg-hanko/10 px-3 py-2 font-mono text-[11px] tracking-[0.12em] text-hanko-bright"
              >
                {t("labels.error")}
                {error?.message ? ` — ${error.message}` : ""}
              </p>
            ) : null}

            {blobUrl && !busy ? (
              <div
                role="status"
                className="flex flex-col gap-2 rounded-md border border-moegi/40 bg-moegi/8 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="font-mono text-[10px] tracking-[0.18em] text-washi-muted">
                  {t("labels.ready")}
                </p>
                <a
                  href={blobUrl}
                  download="labels.pdf"
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-moegi/50 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-moegi transition hover:border-moegi hover:bg-moegi/15"
                >
                  <span aria-hidden="true" className="font-jp text-[12px]">
                    下
                  </span>
                  {t("labels.download")}
                </a>
              </div>
            ) : null}

            <p className="font-mono text-[10px] tracking-[0.18em] text-washi-dim">
              {t("labels.printHint")}
            </p>
          </div>

          <div className="relative flex flex-col gap-2 border-t border-border/70 bg-ink-0/40 px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-washi-muted transition hover:text-washi"
            >
              {t("common.close")}
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={busy || !list.length}
              className="fuda-keycap inline-flex items-center justify-center gap-1.5 rounded-md bg-hanko px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-on-hanko transition hover:bg-hanko-deep disabled:opacity-60"
            >
              <span
                aria-hidden="true"
                className="font-jp text-[12px] not-italic"
              >
                印
              </span>
              {busy
                ? progress
                  ? `${t("labels.generating")} ${progress.done}/${progress.total}`
                  : t("labels.generating")
                : t("labels.generate")}
            </button>
          </div>

          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-3 -left-3 grid h-12 w-12 place-items-center rounded-full border border-hanko/55 bg-ink-1/95 font-jp text-base font-bold text-hanko-bright shadow-md"
            style={{ transform: "rotate(-8deg)" }}
          >
            札
          </span>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

const TITLE_ID = "label-sheet-title";
const TEMPLATE_ID = "label-sheet-template";
const START_ID = "label-sheet-start";

// Same fractal-noise grain LoanModal lays over its slip.
const PAPER_GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")";

/** "66.7" from 66.675 — one decimal, no trailing zero. */
function mm(value) {
  return String(Number(value.toFixed(1)));
}

function clampInt(raw, lo, hi) {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
