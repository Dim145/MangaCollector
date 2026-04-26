import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import CoverImage from "./ui/CoverImage.jsx";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 札 · Shelf-sticker printer.
 *
 * A utility surface — not part of the daily-use chrome — that lets a
 * user print physical shelf labels for their manga collection. Each
 * sticker carries:
 *   - A QR code linking back to the series (`/mangapage?mal_id=N`).
 *     The owner's phone, already authenticated, jumps straight to
 *     the detail page when scanned. Friends scanning won't get the
 *     gated content but will land on the login flow, which is the
 *     correct boundary for a personal-organisation tool.
 *   - The series cover thumbnail (uses the public `image_url_jpg`
 *     from MAL/MangaDex when available; custom uploads gracefully
 *     fall back to the kanji 巻 placeholder via `<CoverImage>`).
 *   - The series title.
 *   - A "X / Y" volume count so a glance at the shelf shows whether
 *     a series is complete.
 *
 * Layout matches the Avery L7160 template (A4, 21 stickers per
 * sheet, 63.5×38.1 mm each, 3 cols × 7 rows). The CSS lives in
 * `index.css` under the `.sticker-sheet` selector chain — page-rule
 * dimensions, mm-precise `@media print` rules, and the screen
 * preview that approximates the printed result at 1.6× scale so the
 * user can read the labels before committing the paper.
 *
 * Workflow:
 *   1. Tick the series you want to label
 *   2. Preview updates live (3-col grid of sticker tiles)
 *   3. Click "Print" → browser print dialog → drop an Avery L7160
 *      sticker sheet in the printer → done
 *
 * The Print button uses `window.print()` here because the output is
 * a paginated grid of small high-contrast labels that printers handle
 * faithfully — exactly the case where print dialogue beats PNG capture
 * (we used PNG for the year-in-review poster because that's a single
 * tall poster, where pagination broke).
 */
export default function ShelfStickersPage() {
  const t = useT();
  const { data: library, isInitialLoad } = useLibrary();

  // Ordered alphabetically — gives the user a stable scan order when
  // hunting for a specific series in a long library.
  const orderedLibrary = useMemo(() => {
    const arr = library ?? [];
    return [...arr].sort((a, b) =>
      String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, {
        sensitivity: "base",
      }),
    );
  }, [library]);

  // Selection state — Set<mal_id>. Default-empty so a user landing on
  // the page can ramp up by ticking only the series they want printed
  // (a typical sheet is a small subset of the full library).
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState("");

  // If the library finishes loading and the user hasn't picked anything
  // yet, pre-select nothing — wasting paper on a 200-sticker sheet they
  // didn't intend is worse than an empty preview.

  const filtered = useMemo(() => {
    if (!search.trim()) return orderedLibrary;
    const needle = search.trim().toLowerCase();
    return orderedLibrary.filter((m) =>
      String(m.name ?? "").toLowerCase().includes(needle),
    );
  }, [orderedLibrary, search]);

  const stickers = useMemo(
    () => orderedLibrary.filter((m) => selected.has(m.mal_id)),
    [orderedLibrary, selected],
  );

  const toggle = (malId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(malId)) next.delete(malId);
      else next.add(malId);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(orderedLibrary.map((m) => m.mal_id)));
  };
  const selectNone = () => setSelected(new Set());

  const handlePrint = () => {
    if (typeof window !== "undefined") window.print();
  };

  // Compute the public origin for QR URLs — defaults to the current
  // page's origin so dev / staging / prod all resolve correctly without
  // a hardcoded domain.
  const baseUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  // L7160 = 21 stickers per A4 page (3 cols × 7 rows). We compute the
  // page count so the user knows how many sheets to load before clicking
  // Print — saves a "wait, was that right?" cancel-and-retry.
  const pageCount = Math.max(1, Math.ceil(stickers.length / 21));

  return (
    <div className="mx-auto max-w-5xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
      {/* ── Header ── */}
      <header className="mb-8 animate-fade-up sticker-printer-header">
        <div className="flex items-baseline gap-3">
          <Link
            to="/settings"
            className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim transition hover:text-washi"
          >
            ← {t("common.back")}
          </Link>
          <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
              {t("shelfStickers.eyebrow")}
            </p>
            <h1 className="mt-1 font-display text-4xl font-light italic leading-none tracking-tight text-washi md:text-5xl">
              <span className="text-hanko-gradient font-semibold not-italic">
                {t("shelfStickers.heading")}
              </span>
            </h1>
            <p className="mt-3 max-w-prose text-sm text-washi-muted">
              {t("shelfStickers.body")}
            </p>
          </div>
          <span
            aria-hidden="true"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-gradient-to-br from-hanko to-hanko-deep font-jp text-2xl font-bold text-washi shadow-[0_4px_20px_var(--hanko-glow)]"
            style={{ transform: "rotate(-4deg)" }}
          >
            札
          </span>
        </div>
      </header>

      {/* ── Picker ── */}
      <section className="sticker-printer-picker mb-8 animate-fade-up rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-washi">
              {t("shelfStickers.pickerTitle")}
            </h2>
            <p className="mt-1 text-xs text-washi-muted">
              {t("shelfStickers.pickerHint", {
                selected: stickers.length,
                total: orderedLibrary.length,
              })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectAll}
              disabled={isInitialLoad || orderedLibrary.length === 0}
              className="rounded-full border border-border bg-transparent px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-washi-muted transition hover:border-border/80 hover:text-washi disabled:opacity-40"
            >
              {t("shelfStickers.selectAll")}
            </button>
            <button
              type="button"
              onClick={selectNone}
              disabled={selected.size === 0}
              className="rounded-full border border-border bg-transparent px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-washi-muted transition hover:border-border/80 hover:text-washi disabled:opacity-40"
            >
              {t("shelfStickers.selectNone")}
            </button>
          </div>
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("shelfStickers.searchPlaceholder")}
          className="mb-4 w-full rounded-lg border border-border bg-ink-0/60 px-3 py-2 text-sm text-washi placeholder:italic placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
        />

        {isInitialLoad ? (
          <p className="text-sm italic text-washi-muted">
            {t("common.loading")}
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-sm italic text-washi-muted">
            {t("shelfStickers.noMatch")}
          </p>
        ) : (
          <ul
            role="listbox"
            aria-multiselectable="true"
            aria-label={t("shelfStickers.pickerTitle")}
            className="grid max-h-[28rem] grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2"
          >
            {filtered.map((m) => {
              const checked = selected.has(m.mal_id);
              return (
                <li key={m.mal_id} className="contents">
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition ${
                      checked
                        ? "border-hanko/60 bg-hanko/10"
                        : "border-border bg-ink-0/40 hover:border-border/80"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(m.mal_id)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={`grid h-4 w-4 shrink-0 place-items-center rounded-sm border transition ${
                        checked
                          ? "border-hanko bg-hanko text-washi"
                          : "border-border"
                      }`}
                    >
                      {checked && (
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
                      )}
                    </span>
                    <span className="block h-10 w-7 shrink-0 overflow-hidden rounded-sm bg-ink-2 ring-1 ring-border">
                      <CoverImage
                        src={m.image_url_jpg}
                        alt=""
                        className="h-full w-full object-cover"
                        imgClassName="h-full w-full object-cover"
                        fallbackKanji="巻"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-sm italic text-washi">
                        {m.name}
                      </span>
                      <span className="block font-mono text-[10px] uppercase tracking-wider text-washi-dim">
                        {Number(m.volumes_owned) || 0} / {Number(m.volumes) || 0}{" "}
                        · {t("manga.volumesShort")}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Print summary + button ── */}
      <section className="sticker-printer-actions mb-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-hanko/20 bg-gradient-to-br from-hanko/5 to-ink-1/40 p-4 animate-fade-up">
        <div>
          <p className="font-display text-sm font-semibold text-washi">
            {t("shelfStickers.summarySelected", { n: stickers.length })}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-washi-muted">
            {t("shelfStickers.summarySheets", {
              pages: pageCount,
              template: "Avery L7160",
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={handlePrint}
          disabled={stickers.length === 0}
          className="inline-flex items-center gap-2 rounded-full bg-hanko px-5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-washi transition hover:bg-hanko-bright active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path d="M6 9V2h12v7" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" rx="1" />
          </svg>
          {t("shelfStickers.printCta")}
        </button>
      </section>

      {/* ── Preview / printable sheet ── */}
      {stickers.length > 0 && (
        <PrintableSheet stickers={stickers} baseUrl={baseUrl} t={t} />
      )}
    </div>
  );
}

/**
 * Printable sheet — Avery L7160 grid of stickers.
 * On screen, it's a scaled preview the user can scan with their eyes.
 * On `@media print`, it's mm-precise so the labels land in the correct
 * adhesive cells of the L7160 sheet.
 */
function PrintableSheet({ stickers, baseUrl, t }) {
  // Chunk into 21-sticker pages so each `<section>` corresponds to one
  // physical sheet of L7160 paper. This makes the print-time
  // page-break-after rules trivial (just break after each section).
  const pages = useMemo(() => {
    const out = [];
    for (let i = 0; i < stickers.length; i += 21) {
      out.push(stickers.slice(i, i + 21));
    }
    return out;
  }, [stickers]);

  return (
    <section
      aria-label={t("shelfStickers.previewLabel")}
      className="sticker-sheet-wrapper"
    >
      <div className="mb-4 flex items-baseline justify-between gap-3 print:hidden">
        <h2 className="font-display text-lg font-semibold text-washi">
          {t("shelfStickers.previewTitle")}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
          {t("shelfStickers.previewCaption")}
        </span>
      </div>

      {pages.map((pageStickers, pageIdx) => (
        <div
          key={pageIdx}
          className="sticker-sheet"
          aria-label={t("shelfStickers.pageNum", { n: pageIdx + 1 })}
        >
          {pageStickers.map((m) => (
            <Sticker key={m.mal_id} entry={m} baseUrl={baseUrl} t={t} />
          ))}
          {/* Pad with empty cells so the grid keeps its 21-cell shape
              even on the last (partial) page. Empty cells just sit
              blank — the adhesive paper underneath stays unused. */}
          {Array.from({ length: 21 - pageStickers.length }).map((_, i) => (
            <div key={`blank-${i}`} className="sticker-blank" />
          ))}
        </div>
      ))}
    </section>
  );
}

function Sticker({ entry, baseUrl, t }) {
  const url = `${baseUrl}/mangapage?mal_id=${entry.mal_id}`;
  const owned = Number(entry.volumes_owned) || 0;
  const total = Number(entry.volumes) || 0;
  return (
    <article className="sticker">
      <span className="sticker-cover">
        <CoverImage
          src={entry.image_url_jpg}
          alt=""
          className="h-full w-full object-cover"
          imgClassName="h-full w-full object-cover"
          fallbackKanji="巻"
        />
      </span>
      <div className="sticker-body">
        <p className="sticker-title">{entry.name}</p>
        <p className="sticker-meta">
          {owned} / {total} · {t("manga.volumesShort")}
        </p>
      </div>
      <span className="sticker-qr" aria-label={t("shelfStickers.qrAria")}>
        <QRCodeSVG
          value={url}
          size={80}
          level="M"
          bgColor="#ffffff"
          fgColor="#0a0908"
          marginSize={0}
        />
      </span>
    </article>
  );
}
