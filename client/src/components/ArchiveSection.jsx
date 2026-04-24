import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Modal from "./ui/Modal.jsx";
import { useArchive } from "@/hooks/useArchive.js";
import { useT } from "@/i18n/index.jsx";

/**
 * Settings section — 写本 Archive & portability.
 *
 * Two actions on the left column (Export JSON / Export CSV) and one on
 * the right (Import). Import opens a 3-step modal:
 *   ① Choose file (FileReader → JSON parse)
 *   ② Preview (dry-run call, show counts + series list)
 *   ③ Apply (commit call, show success summary)
 */
export default function ArchiveSection() {
  const t = useT();
  const [importOpen, setImportOpen] = useState(false);
  const {
    exportJson,
    exportCsv,
    isExporting,
  } = useArchive();

  return (
    <section
      className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up"
      style={{ animationDelay: "260ms" }}
    >
      {/* Header */}
      <div className="mb-4 flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid h-5 w-5 place-items-center rounded-full bg-gold/15 font-jp text-[10px] font-bold text-gold"
        >
          写
        </span>
        <div>
          <h2 className="font-display text-lg font-semibold text-washi">
            {t("settings.archiveTitle")}
          </h2>
          <p className="mt-1 text-xs text-washi-muted">
            {t("settings.archiveBody")}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* ─── Export column ─── */}
        <div className="rounded-xl border border-border bg-ink-0/40 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="font-jp text-xs text-gold-muted">巻</span>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-washi-muted">
              {t("settings.archiveExport")}
            </p>
          </div>
          <p className="mb-4 text-xs text-washi-muted">
            {t("settings.archiveExportBody")}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => exportJson().catch(() => {})}
              disabled={isExporting}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gold transition hover:bg-gold/20 active:scale-95 disabled:opacity-40"
            >
              {isExporting ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
              ) : (
                <DownloadIcon />
              )}
              {t("settings.archiveExportJson")}
            </button>
            <button
              type="button"
              onClick={() => exportCsv().catch(() => {})}
              disabled={isExporting}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-ink-2/60 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:border-gold/40 hover:text-washi active:scale-95 disabled:opacity-40"
            >
              <DownloadIcon />
              {t("settings.archiveExportCsv")}
            </button>
          </div>
        </div>

        {/* ─── Import column ─── */}
        <div className="rounded-xl border border-border bg-ink-0/40 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="font-jp text-xs text-gold-muted">封</span>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-washi-muted">
              {t("settings.archiveImport")}
            </p>
          </div>
          <p className="mb-4 text-xs text-washi-muted">
            {t("settings.archiveImportBody")}
          </p>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-hanko/40 bg-hanko/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-hanko-bright transition hover:bg-hanko/20 active:scale-95"
          >
            <UploadIcon />
            {t("settings.archiveImportCta")}
          </button>

          {/* External import link — dedicated page since the flow is
              quite different (per-service wizard, fetches live data). */}
          <Link
            to="/settings/import-external"
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-ink-2/30 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:border-hanko/40 hover:text-washi active:scale-95"
          >
            <span className="font-jp text-sm leading-none">外</span>
            {t("settings.archiveImportExternalCta")}
          </Link>
        </div>
      </div>

      <ImportFlow
        open={importOpen}
        onClose={() => setImportOpen(false)}
      />
    </section>
  );
}

/**
 * Three-step import modal.
 *
 * We keep all three steps inside a single <Modal> and flip between
 * them with local state rather than nesting modals — less stacking
 * context drama, the user can navigate back/forward cleanly.
 */
function ImportFlow({ open, onClose }) {
  const t = useT();
  const {
    preview,
    isPreviewing,
    previewError,
    commit,
    isCommitting,
    commitError,
    reset: resetMutations,
  } = useArchive();
  const [step, setStep] = useState("choose");
  const [filename, setFilename] = useState("");
  const [bundle, setBundle] = useState(null);
  const [previewResult, setPreviewResult] = useState(null);
  const [commitResult, setCommitResult] = useState(null);
  const [parseError, setParseError] = useState(null);
  const fileInputRef = useRef(null);

  const reset = () => {
    setStep("choose");
    setFilename("");
    setBundle(null);
    setPreviewResult(null);
    setCommitResult(null);
    setParseError(null);
    resetMutations();
  };

  const handleClose = () => {
    reset();
    onClose?.();
  };

  const onFileChosen = async (file) => {
    setParseError(null);
    setFilename(file.name);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed?.version || !Array.isArray(parsed?.library)) {
        throw new Error("not-a-bundle");
      }
      setBundle(parsed);
      setStep("preview");
      const result = await preview(parsed);
      setPreviewResult(result);
    } catch (err) {
      setParseError(
        err?.message === "not-a-bundle"
          ? t("settings.archiveImportNotBundle")
          : t("settings.archiveImportBadJson"),
      );
      setStep("choose");
    }
  };

  const handleCommit = async () => {
    if (!bundle) return;
    try {
      const result = await commit(bundle);
      setCommitResult(result);
      setStep("done");
    } catch {
      /* error surfaces via commitError in the preview step */
    }
  };

  return (
    <Modal
      popupOpen={open}
      handleClose={handleClose}
      additionalClasses="w-[min(95vw,640px)] rounded-2xl border border-border bg-ink-1 p-0"
    >
      {/* Step tracker — 3 dots with the current step filled */}
      <div className="flex items-center gap-4 border-b border-border/60 bg-ink-2/30 px-6 py-4">
        <span
          aria-hidden="true"
          className="font-jp text-xl font-bold text-gold"
          style={{ transform: "rotate(-2deg)" }}
        >
          写
        </span>
        <div className="flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
            {t("settings.archiveImportStep", {
              step:
                step === "choose" ? 1 : step === "preview" ? 2 : 3,
              total: 3,
            })}
          </p>
          <p className="mt-0.5 font-display text-lg italic text-washi">
            {step === "choose"
              ? t("settings.archiveImportStep1Title")
              : step === "preview"
                ? t("settings.archiveImportStep2Title")
                : t("settings.archiveImportStep3Title")}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {[1, 2, 3].map((n) => {
            const currentN =
              step === "choose" ? 1 : step === "preview" ? 2 : 3;
            return (
              <span
                key={n}
                className={`h-1.5 w-6 rounded-full transition-colors ${
                  n <= currentN ? "bg-hanko" : "bg-border"
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* ── Step body ── */}
      <div className="px-6 py-6">
        {step === "choose" && (
          <ChooseStep
            filename={filename}
            parseError={parseError}
            onPick={() => fileInputRef.current?.click()}
            onFile={onFileChosen}
            fileInputRef={fileInputRef}
          />
        )}
        {step === "preview" && (
          <PreviewStep
            filename={filename}
            isPreviewing={isPreviewing}
            result={previewResult}
            error={previewError}
          />
        )}
        {step === "done" && <DoneStep result={commitResult} />}
      </div>

      {/* ── Footer / actions ── */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 bg-ink-2/20 px-6 py-4">
        {step === "preview" && (
          <>
            <button
              type="button"
              onClick={() => {
                reset();
                setStep("choose");
              }}
              className="rounded-full border border-border bg-transparent px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-washi-muted transition hover:text-washi"
            >
              {t("settings.archiveImportChooseAgain")}
            </button>
            <button
              type="button"
              onClick={handleCommit}
              disabled={
                isPreviewing ||
                isCommitting ||
                !previewResult ||
                previewResult.added === 0
              }
              className="inline-flex items-center gap-2 rounded-full bg-hanko px-5 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-washi shadow-lg transition hover:bg-hanko-bright disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isCommitting ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-washi/30 border-t-washi" />
              ) : null}
              {t("settings.archiveImportApply", {
                n: previewResult?.added ?? 0,
              })}
            </button>
          </>
        )}
        {step === "done" && (
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full bg-hanko px-5 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-washi shadow-lg transition hover:bg-hanko-bright"
          >
            {t("common.close")}
          </button>
        )}
        {step === "choose" && (
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full border border-border bg-transparent px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-washi-muted transition hover:text-washi"
          >
            {t("common.cancel")}
          </button>
        )}
      </div>

      {commitError && step === "preview" && (
        <div className="border-t border-hanko/40 bg-hanko/10 px-6 py-3 text-xs text-hanko-bright">
          {commitError?.response?.data?.error ??
            t("settings.archiveImportGenericError")}
        </div>
      )}
    </Modal>
  );
}

/* ══════════════ Steps ══════════════ */

function ChooseStep({ filename, parseError, onPick, onFile, fileInputRef }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center text-center">
      <p className="max-w-md text-sm text-washi-muted">
        {t("settings.archiveImportStep1Body")}
      </p>

      <button
        type="button"
        onClick={onPick}
        className="mt-6 inline-flex items-center gap-3 rounded-xl border-2 border-dashed border-border bg-ink-0/30 px-8 py-6 text-left transition hover:border-hanko/50 hover:bg-ink-0/60"
      >
        <UploadIcon big />
        <div>
          <p className="font-display text-sm font-semibold text-washi">
            {filename
              ? t("settings.archiveImportChooseDifferent")
              : t("settings.archiveImportChoose")}
          </p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.25em] text-washi-dim">
            {filename || "mangacollector-*.json"}
          </p>
        </div>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
        className="hidden"
      />

      {parseError && (
        <p className="mt-4 rounded-md border border-hanko/30 bg-hanko/10 px-3 py-2 text-xs text-hanko-bright">
          {parseError}
        </p>
      )}
    </div>
  );
}

function PreviewStep({ filename, isPreviewing, result, error }) {
  const t = useT();
  const added = result?.added ?? 0;
  const skipped = result?.skipped_conflict ?? 0;
  const invalid = result?.skipped_invalid ?? 0;

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.25em] text-washi-dim">
        {t("settings.archiveImportPreviewOf")} ·{" "}
        <span className="text-washi-muted">{filename}</span>
      </p>

      {isPreviewing && (
        <div className="flex items-center justify-center py-10">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-hanko/30 border-t-hanko" />
        </div>
      )}

      {error && !isPreviewing && (
        <p className="rounded-md border border-hanko/30 bg-hanko/10 px-3 py-2 text-sm text-hanko-bright">
          {error?.response?.data?.error ??
            t("settings.archiveImportGenericError")}
        </p>
      )}

      {result && !isPreviewing && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <PreviewChip
              label={t("settings.archiveImportAdded")}
              value={added}
              accent="moegi"
            />
            <PreviewChip
              label={t("settings.archiveImportConflict")}
              value={skipped}
              accent="gold"
            />
            <PreviewChip
              label={t("settings.archiveImportInvalid")}
              value={invalid}
              accent="hanko"
            />
          </div>

          {result.added_series?.length > 0 && (
            <CollapsibleList
              title={t("settings.archiveImportAddedList")}
              items={result.added_series}
              accent="moegi"
            />
          )}
          {result.conflict_series?.length > 0 && (
            <CollapsibleList
              title={t("settings.archiveImportConflictList")}
              items={result.conflict_series}
              accent="gold"
            />
          )}

          {added === 0 && skipped > 0 && (
            <p className="mt-5 rounded-md border border-border bg-ink-2/40 px-4 py-3 text-xs text-washi-muted">
              {t("settings.archiveImportNothingToAdd")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function PreviewChip({ label, value, accent }) {
  const colour =
    accent === "moegi"
      ? "text-moegi"
      : accent === "gold"
        ? "text-gold"
        : accent === "hanko"
          ? "text-hanko-bright"
          : "text-washi";
  return (
    <div className="rounded-lg border border-border bg-ink-2/40 p-3 text-center">
      <p className={`font-display text-3xl font-semibold tabular-nums ${colour}`}>
        {value}
      </p>
      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-washi-dim">
        {label}
      </p>
    </div>
  );
}

function CollapsibleList({ title, items, accent }) {
  const [open, setOpen] = useState(false);
  const show = open ? items : items.slice(0, 5);
  const colour =
    accent === "moegi"
      ? "text-moegi"
      : accent === "gold"
        ? "text-gold"
        : "text-washi";
  const preview = useMemo(
    () => items.slice(0, 3).map((it) => it.name).join(" · "),
    [items],
  );
  return (
    <details
      className="mt-4 rounded-lg border border-border bg-ink-2/30"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer list-none px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim hover:text-washi">
        <span className={`mr-2 font-display text-xs italic ${colour}`}>
          {title} · {items.length}
        </span>
        {!open && (
          <span className="text-[10px] normal-case tracking-normal text-washi-dim">
            {preview}
            {items.length > 3 ? "…" : ""}
          </span>
        )}
      </summary>
      <ul className="max-h-56 overflow-y-auto border-t border-border/60 px-3 py-2 text-xs">
        {show.map((it, i) => (
          <li
            key={`${it.mal_id ?? "custom"}-${i}`}
            className="flex items-baseline justify-between gap-3 py-1 font-sans text-washi-muted"
          >
            <span className="min-w-0 flex-1 truncate font-display italic text-washi">
              {it.name}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-washi-dim">
              {it.owned_volumes}/{it.volumes}
            </span>
          </li>
        ))}
        {!open && items.length > 5 && (
          <li className="mt-1 text-center text-[10px] text-washi-dim">
            … {items.length - 5} more
          </li>
        )}
      </ul>
    </details>
  );
}

function DoneStep({ result }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center text-center">
      <div
        className="hanko-seal grid h-16 w-16 place-items-center rounded-md font-jp text-2xl"
        style={{ transform: "rotate(-4deg)" }}
      >
        封
      </div>
      <h3 className="mt-5 font-display text-2xl italic text-washi">
        {t("settings.archiveImportDoneTitle")}
      </h3>
      <p className="mt-2 max-w-md text-sm text-washi-muted">
        {t("settings.archiveImportDoneBody", {
          added: result?.added ?? 0,
          skipped: result?.skipped_conflict ?? 0,
        })}
      </p>
    </div>
  );
}

/* ══════════════ Icons ══════════════ */

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function UploadIcon({ big }) {
  const size = big ? "h-8 w-8" : "h-3.5 w-3.5";
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${size} text-gold`}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
