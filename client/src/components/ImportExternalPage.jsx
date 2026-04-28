import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import DefaultBackground from "./DefaultBackground";
import { useExternalImport } from "@/hooks/useExternalImport.js";
import { notifySyncError } from "@/lib/sync.js";
import { useT } from "@/i18n/index.jsx";

/**
 * /settings/import-external · 外部輸入 page.
 *
 * Three service cards: MyAnimeList, MangaDex, AniList. Each opens an
 * in-page wizard (no modal — the page IS the flow so the back-button
 * and deep-linkability both work). The wizard has 3 phases:
 *
 *   "choose"  — pick a service
 *   "input"   — enter the service-specific handle / UUID
 *   "preview" — see what will be added, confirm
 *   "done"    — final summary
 */
export default function ImportExternalPage() {
  const t = useT();
  const [phase, setPhase] = useState("choose");
  const [service, setService] = useState(null);
  const [input, setInput] = useState("");
  const [bundle, setBundle] = useState(null);
  const [preview, setPreview] = useState(null);
  const [committed, setCommitted] = useState(null);
  const [error, setError] = useState(null);

  const {
    fetchMal,
    fetchAniList,
    fetchMangaDex,
    fetchYamtrack,
    commit,
    isFetchingMal,
    isFetchingAniList,
    isFetchingMangaDex,
    isFetchingYamtrack,
    isCommitting,
  } = useExternalImport();

  const isFetching =
    isFetchingMal ||
    isFetchingAniList ||
    isFetchingMangaDex ||
    isFetchingYamtrack;

  const reset = () => {
    setPhase("choose");
    setService(null);
    setInput("");
    setBundle(null);
    setPreview(null);
    setCommitted(null);
    setError(null);
  };

  const openService = (id) => {
    setService(id);
    setInput("");
    setPhase("input");
    setError(null);
  };

  const handleFetch = async () => {
    setError(null);
    try {
      let resp;
      if (service === "mal") resp = await fetchMal(input);
      else if (service === "anilist") resp = await fetchAniList(input);
      else if (service === "mangadex") resp = await fetchMangaDex(input);
      else if (service === "yamtrack") resp = await fetchYamtrack(input);
      if (!resp) return;
      setBundle(resp.bundle);
      setPreview(resp.preview);
      setPhase("preview");
    } catch (e) {
      // Inline display stays — multi-step UX needs the error visible
      // next to the input the user just typed. Toast also fires so a
      // user with focus elsewhere doesn't miss the failure.
      const message =
        e?.response?.data?.error ?? t("importExternal.genericError");
      setError(message);
      notifySyncError(message, "import-external-fetch");
    }
  };

  const handleCommit = async () => {
    if (!bundle) return;
    setError(null);
    try {
      const result = await commit(bundle);
      setCommitted(result);
      setPhase("done");
    } catch (e) {
      const message =
        e?.response?.data?.error ?? t("importExternal.genericError");
      setError(message);
      notifySyncError(message, "import-external-commit");
    }
  };

  return (
    <DefaultBackground>
      <div className="mx-auto max-w-5xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
        {/* Masthead */}
        <header className="mb-8 animate-fade-up">
          <div className="flex items-baseline gap-3">
            <Link
              to="/settings"
              className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim transition hover:text-washi"
            >
              ← {t("importExternal.backToSettings")}
            </Link>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>
          <h1 className="mt-2 font-display text-4xl font-light italic leading-none tracking-tight text-washi md:text-5xl">
            {t("importExternal.title")}{" "}
            <span className="text-hanko-gradient font-semibold not-italic">
              {t("importExternal.titleAccent")}
            </span>
          </h1>
          <p className="mt-4 max-w-2xl font-sans text-sm text-washi-muted">
            {t("importExternal.subtitle")}
          </p>
        </header>

        {/* ─── Phase: CHOOSE ─── */}
        {phase === "choose" && (
          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
            aria-label={t("importExternal.servicesLabel")}
          >
            <ServiceCard
              id="mal"
              onClick={() => openService("mal")}
              kanji="本"
              title="MyAnimeList"
              inputLabel={t("importExternal.malInputKind")}
              blurb={t("importExternal.malBlurb")}
              accent="hanko"
              order={0}
            />
            <ServiceCard
              id="mangadex"
              onClick={() => openService("mangadex")}
              kanji="巻"
              title="MangaDex"
              inputLabel={t("importExternal.mdInputKind")}
              blurb={t("importExternal.mdBlurb")}
              accent="gold"
              order={1}
            />
            <ServiceCard
              id="anilist"
              onClick={() => openService("anilist")}
              kanji="名"
              title="AniList"
              inputLabel={t("importExternal.aniInputKind")}
              blurb={t("importExternal.aniBlurb")}
              accent="moegi"
              order={2}
            />
            <ServiceCard
              id="yamtrack"
              onClick={() => openService("yamtrack")}
              kanji="蔵"
              title="Yamtrack"
              inputLabel={t("importExternal.ymInputKind")}
              blurb={t("importExternal.ymBlurb")}
              accent="sakura"
              order={3}
            />
          </div>
        )}

        {/* ─── Phase: INPUT ─── */}
        {phase === "input" && (
          <InputPhase
            service={service}
            input={input}
            setInput={setInput}
            onCancel={reset}
            onFetch={handleFetch}
            isFetching={isFetching}
            error={error}
          />
        )}

        {/* ─── Phase: PREVIEW ─── */}
        {phase === "preview" && (
          <PreviewPhase
            service={service}
            bundle={bundle}
            preview={preview}
            onBack={() => {
              setPhase("input");
              setBundle(null);
              setPreview(null);
            }}
            onCommit={handleCommit}
            isCommitting={isCommitting}
            error={error}
          />
        )}

        {/* ─── Phase: DONE ─── */}
        {phase === "done" && (
          <DonePhase result={committed} onReset={reset} />
        )}
      </div>
    </DefaultBackground>
  );
}

/* ══════════════ Service card ══════════════ */

function ServiceCard({ id, onClick, kanji, title, inputLabel, blurb, accent, order = 0 }) {
  const t = useT();
  const accentCls =
    accent === "hanko"
      ? "text-hanko-bright group-hover:bg-hanko/10 group-hover:border-hanko/60"
      : accent === "gold"
        ? "text-gold group-hover:bg-gold/10 group-hover:border-gold/60"
        : accent === "sakura"
          ? "text-sakura group-hover:bg-sakura/10 group-hover:border-sakura/60"
          : "text-moegi group-hover:bg-moegi/10 group-hover:border-moegi/60";
  return (
    <button
      type="button"
      id={id ? `import-service-${id}` : undefined}
      onClick={onClick}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-6 text-left backdrop-blur transition-all duration-300 animate-fade-up hover:-translate-y-1 ${accentCls}`}
      style={{ animationDelay: `${order * 80}ms` }}
    >
      <span
        aria-hidden="true"
        className={`font-jp text-4xl font-bold leading-none ${accentCls.split(" ")[0]}`}
        style={{ transform: "rotate(-4deg)" }}
      >
        {kanji}
      </span>
      <h3 className="mt-4 font-display text-2xl font-semibold italic text-washi">
        {title}
      </h3>
      <p
        className={`mt-1 font-mono text-[10px] uppercase tracking-[0.3em] ${accentCls.split(" ")[0]}`}
      >
        {inputLabel}
      </p>
      <p className="mt-4 flex-1 text-sm text-washi-muted">{blurb}</p>
      <span className="mt-6 inline-flex items-center gap-2 self-start font-mono text-[10px] uppercase tracking-[0.2em] text-washi-muted transition group-hover:text-washi">
        {t("importExternal.openService")} →
      </span>
    </button>
  );
}

/* ══════════════ Input phase ══════════════ */

function InputPhase({ service, input, setInput, onCancel, onFetch, isFetching, error }) {
  const t = useT();
  const meta = SERVICE_META[service] ?? SERVICE_META.mal;
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState("");

  const handleFileChosen = async (file) => {
    try {
      const text = await file.text();
      setFileName(file.name);
      setInput(text);
    } catch {
      setFileName("");
      setInput("");
    }
  };

  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <div className="mb-4 flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`grid h-9 w-9 place-items-center rounded-md font-jp text-lg font-bold ${meta.kanjiClass}`}
          style={{ transform: "rotate(-3deg)" }}
        >
          {meta.kanji}
        </span>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
            {meta.serviceName}
          </p>
          <h2 className="font-display text-xl font-semibold italic text-washi">
            {t(meta.inputTitleKey)}
          </h2>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur">
        <label
          htmlFor="external-input"
          className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim"
        >
          {t(meta.inputLabelKey)}
        </label>
        {meta.inputKind === "file" ? (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center gap-3 rounded-lg border-2 border-dashed border-border bg-ink-0/30 px-4 py-4 text-left transition hover:border-sakura/50 hover:bg-ink-0/60"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6 shrink-0 text-sakura"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-semibold text-washi">
                  {fileName
                    ? t("importExternal.fileChosen")
                    : t("importExternal.chooseFile")}
                </p>
                <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
                  {fileName || t(meta.placeholderKey)}
                </p>
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileChosen(f);
                e.target.value = "";
              }}
              className="hidden"
            />
          </>
        ) : meta.multiline ? (
          <textarea
            id="external-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t(meta.placeholderKey)}
            rows={5}
            className="w-full rounded-lg border border-border bg-ink-1 px-4 py-3 font-mono text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
          />
        ) : (
          <input
            id="external-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim() && !isFetching) {
                onFetch();
              }
            }}
            placeholder={t(meta.placeholderKey)}
            className="w-full rounded-lg border border-border bg-ink-1 px-4 py-3 font-sans text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
          />
        )}
        <p className="mt-2 font-mono text-[10px] tracking-wider text-washi-dim">
          {t(meta.hintKey)}
        </p>

        {error && (
          <p className="mt-4 rounded-md border border-hanko/30 bg-hanko/10 px-3 py-2 text-xs text-hanko-bright">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isFetching}
            className="rounded-full border border-border bg-transparent px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-washi-muted transition hover:text-washi disabled:opacity-40"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onFetch}
            disabled={isFetching || !input.trim()}
            className="inline-flex items-center gap-2 rounded-full bg-hanko px-5 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-washi shadow-lg transition hover:bg-hanko-bright disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isFetching && (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-washi/30 border-t-washi" />
            )}
            {isFetching
              ? t("importExternal.fetching")
              : t("importExternal.preview")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════ Preview phase ══════════════ */

function PreviewPhase({ service, bundle, preview, onBack, onCommit, isCommitting, error }) {
  const t = useT();
  const meta = SERVICE_META[service] ?? SERVICE_META.mal;
  const added = preview?.added ?? 0;
  const conflict = preview?.skipped_conflict ?? 0;
  const invalid = preview?.skipped_invalid ?? 0;
  const total = preview?.total_in_file ?? bundle?.library?.length ?? 0;

  return (
    <div className="mx-auto max-w-3xl animate-fade-up">
      <div className="mb-4 flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`grid h-9 w-9 place-items-center rounded-md font-jp text-lg font-bold ${meta.kanjiClass}`}
          style={{ transform: "rotate(-3deg)" }}
        >
          {meta.kanji}
        </span>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
            {t("importExternal.previewEyebrow")} · {meta.serviceName}
          </p>
          <h2 className="font-display text-xl font-semibold italic text-washi">
            {t("importExternal.previewTitle", { total })}
          </h2>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur">
        <div className="grid grid-cols-3 gap-3">
          <PreviewChip
            label={t("importExternal.added")}
            value={added}
            accent="moegi"
          />
          <PreviewChip
            label={t("importExternal.conflict")}
            value={conflict}
            accent="gold"
          />
          <PreviewChip
            label={t("importExternal.invalid")}
            value={invalid}
            accent="hanko"
          />
        </div>

        {preview?.added_series?.length > 0 && (
          <SeriesList
            title={t("importExternal.addedList")}
            items={preview.added_series}
            accent="moegi"
          />
        )}
        {preview?.conflict_series?.length > 0 && (
          <SeriesList
            title={t("importExternal.conflictList")}
            items={preview.conflict_series}
            accent="gold"
          />
        )}

        {added === 0 && (
          <p className="mt-5 rounded-md border border-border bg-ink-2/40 px-4 py-3 text-xs text-washi-muted">
            {t("importExternal.nothingToAdd")}
          </p>
        )}

        {error && (
          <p className="mt-5 rounded-md border border-hanko/30 bg-hanko/10 px-3 py-2 text-xs text-hanko-bright">
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full border border-border bg-transparent px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-washi-muted transition hover:text-washi"
          >
            ← {t("common.back")}
          </button>
          <button
            type="button"
            onClick={onCommit}
            disabled={isCommitting || added === 0}
            className="inline-flex items-center gap-2 rounded-full bg-hanko px-5 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-washi shadow-lg transition hover:bg-hanko-bright disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isCommitting && (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-washi/30 border-t-washi" />
            )}
            {t("importExternal.apply", { n: added })}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewChip({ label, value, accent }) {
  const cls =
    accent === "moegi"
      ? "text-moegi"
      : accent === "gold"
        ? "text-gold"
        : "text-hanko-bright";
  return (
    <div className="rounded-lg border border-border bg-ink-2/40 p-4 text-center">
      <p
        className={`font-display text-3xl font-semibold tabular-nums ${cls}`}
      >
        {value}
      </p>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.25em] text-washi-dim">
        {label}
      </p>
    </div>
  );
}

function SeriesList({ title, items, accent }) {
  const [open, setOpen] = useState(false);
  const show = open ? items : items.slice(0, 5);
  const cls =
    accent === "moegi"
      ? "text-moegi"
      : accent === "gold"
        ? "text-gold"
        : "text-washi";
  return (
    <details
      className="mt-4 rounded-lg border border-border bg-ink-2/30"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer list-none px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim hover:text-washi">
        <span className={`mr-2 font-display text-xs italic ${cls}`}>
          {title} · {items.length}
        </span>
      </summary>
      <ul className="max-h-64 overflow-y-auto border-t border-border/60 px-3 py-2 text-xs">
        {show.map((it, i) => (
          <li
            key={`${it.mal_id ?? "custom"}-${i}`}
            className="flex items-baseline justify-between gap-3 py-1"
          >
            <span className="min-w-0 flex-1 truncate font-display italic text-washi">
              {it.name}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-washi-dim">
              {it.volumes > 0 ? `${it.volumes} vol.` : "—"}
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

/* ══════════════ Done phase ══════════════ */

function DonePhase({ result, onReset }) {
  const t = useT();
  return (
    <div className="mx-auto max-w-xl py-10 text-center animate-fade-up">
      <div
        className="hanko-seal mx-auto grid h-20 w-20 place-items-center rounded-md font-jp text-3xl"
        style={{ transform: "rotate(-4deg)" }}
      >
        輸
      </div>
      <h2 className="mt-6 font-display text-3xl font-light italic text-washi">
        {t("importExternal.doneTitle")}
      </h2>
      <p className="mt-3 text-sm text-washi-muted">
        {t("importExternal.doneBody", {
          added: result?.added ?? 0,
          skipped: result?.skipped_conflict ?? 0,
        })}
      </p>
      <div className="mt-8 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-border bg-transparent px-5 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-washi-muted transition hover:text-washi"
        >
          {t("importExternal.importAnother")}
        </button>
        <Link
          to="/dashboard"
          className="rounded-full bg-hanko px-5 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-washi shadow-lg transition hover:bg-hanko-bright"
        >
          {t("importExternal.goToLibrary")}
        </Link>
      </div>
    </div>
  );
}

/* ══════════════ Per-service metadata for the wizard ══════════════ */

const SERVICE_META = {
  mal: {
    serviceName: "MyAnimeList",
    kanji: "本",
    kanjiClass: "bg-hanko/15 text-hanko-bright",
    multiline: false,
    inputTitleKey: "importExternal.malInputTitle",
    inputLabelKey: "importExternal.malInputLabel",
    placeholderKey: "importExternal.malPlaceholder",
    hintKey: "importExternal.malHint",
  },
  mangadex: {
    serviceName: "MangaDex",
    kanji: "巻",
    kanjiClass: "bg-gold/15 text-gold",
    multiline: true,
    inputTitleKey: "importExternal.mdInputTitle",
    inputLabelKey: "importExternal.mdInputLabel",
    placeholderKey: "importExternal.mdPlaceholder",
    hintKey: "importExternal.mdHint",
  },
  anilist: {
    serviceName: "AniList",
    kanji: "名",
    kanjiClass: "bg-moegi/15 text-moegi",
    multiline: false,
    inputTitleKey: "importExternal.aniInputTitle",
    inputLabelKey: "importExternal.aniInputLabel",
    placeholderKey: "importExternal.aniPlaceholder",
    hintKey: "importExternal.aniHint",
  },
  yamtrack: {
    serviceName: "Yamtrack",
    kanji: "蔵",
    kanjiClass: "bg-sakura/15 text-sakura",
    // File upload kind — renders a dropzone button instead of a text
    // input. The file's raw text ends up in `input` for POST to the
    // backend which parses the CSV server-side.
    inputKind: "file",
    inputTitleKey: "importExternal.ymInputTitle",
    inputLabelKey: "importExternal.ymInputLabel",
    placeholderKey: "importExternal.ymPlaceholder",
    hintKey: "importExternal.ymHint",
  },
};
