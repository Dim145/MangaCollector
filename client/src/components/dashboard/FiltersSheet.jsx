import { useMemo, useState } from "react";
import Sheet from "@/components/ui/Sheet.jsx";
import { useT } from "@/i18n/index.jsx";
import {
  DEFAULT_SORT,
  SORT_KEYS,
  defaultDirFor,
  normalizeSort,
} from "@/utils/librarySort.js";
import { LENSES, SORT_LABEL_KEYS, tagCounts } from "./viewOptions.js";

/**
 * 題 · The dashboard's refinements on a phone, in one sheet: the order
 * of the shelf, the time-based lenses and the genres.
 *
 * On a 390 px screen the sort button, the lens row and the genre
 * popover stood between the reader and the first cover, which began at
 * 630 px of an 844 px screen. They are gathered here behind the one
 * "Filters" button that sits beside the search field; what is active
 * stays visible outside as removable chips (`ActiveChips`). The status
 * tabs stay on the page: they are the primary axis.
 *
 * Every change applies at once — the grid behind is the preview, the
 * footer counts what it holds and closes the sheet.
 */
export default function FiltersSheet({
  open,
  onClose,
  library,
  activeTags,
  onToggleTag,
  lens,
  onLens,
  sort,
  onSort,
  resultsCount,
  onReset,
  onSelectSeries,
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const tags = useMemo(() => tagCounts(library), [library]);
  const shownTags = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? tags.filter((x) => x.name.toLowerCase().includes(q)) : tags;
  }, [tags, query]);
  const current = normalizeSort(sort);
  const isDefaultSort =
    current.key === DEFAULT_SORT.key && current.dir === DEFAULT_SORT.dir;
  const dirty = activeTags.size > 0 || lens != null || !isDefaultSort;

  const chip =
    "inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition pointer-coarse:min-h-11 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-hanko/50";
  const legend =
    "mb-2.5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-washi-dim";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      glyph="題"
      eyebrow={t("dashboard.sheetEyebrow")}
      title={t("dashboard.sheetTitle")}
      footer={
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onReset}
            disabled={!dirty}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-mono text-[11px] uppercase tracking-[0.18em] text-washi-muted transition hover:text-hanko-bright disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-washi-muted"
          >
            <span aria-hidden="true" className="font-jp text-[13px] leading-none">
              解
            </span>
            {t("dashboard.sheetReset")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-hanko px-5 text-sm font-semibold text-on-hanko shadow-lg transition active:scale-[0.98]"
          >
            {t("dashboard.sheetShow", { n: resultsCount })}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* 並 · Order. Native radios: arrow keys move between them, and
            the chip is their label. */}
        <fieldset>
          <legend className={legend}>
            <span aria-hidden="true" className="font-jp text-[13px] normal-case tracking-normal">
              並
            </span>
            {t("dashboard.sortTitle")}
          </legend>
          <div className="flex flex-wrap gap-2">
            {SORT_KEYS.map((k) => {
              const active = k.id === current.key;
              return (
                <label
                  key={k.id}
                  className={`${chip} ${
                    active
                      ? "border-gold/70 bg-gold/15 text-washi"
                      : "border-border text-washi-muted hover:text-washi"
                  }`}
                >
                  <input
                    type="radio"
                    name="dashboard-sort-key"
                    value={k.id}
                    checked={active}
                    onChange={() =>
                      onSort({ key: k.id, dir: defaultDirFor(k.id) })
                    }
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={`font-jp text-[13px] leading-none ${active ? "text-gold" : "text-washi-dim"}`}
                  >
                    {k.glyph}
                  </span>
                  {t(SORT_LABEL_KEYS[k.id])}
                </label>
              );
            })}
          </div>
          <div
            role="radiogroup"
            aria-label={t("dashboard.sortDirection")}
            className="mt-3 inline-flex rounded-full border border-border p-0.5"
          >
            {["asc", "desc"].map((dir) => {
              const active = current.dir === dir;
              return (
                <label
                  key={dir}
                  className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[13px] transition pointer-coarse:min-h-11 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-hanko/50 ${
                    active ? "bg-gold/15 text-washi" : "text-washi-muted hover:text-washi"
                  }`}
                >
                  <input
                    type="radio"
                    name="dashboard-sort-dir"
                    value={dir}
                    checked={active}
                    onChange={() => onSort({ key: current.key, dir })}
                    className="sr-only"
                  />
                  <span aria-hidden="true" className="font-mono text-[12px]">
                    {dir === "asc" ? "↑" : "↓"}
                  </span>
                  {t(dir === "asc" ? "dashboard.sortDirAsc" : "dashboard.sortDirDesc")}
                </label>
              );
            })}
          </div>
          <p className="mt-2 font-display text-[13px] italic text-washi-dim">
            {t("dashboard.sortGapsNote")}
          </p>
        </fieldset>

        {/* 鏡 · Lenses — one at a time, and tapping the active one again
            lets it go; a lens resets the status tab to "all". */}
        <fieldset>
          <legend className={legend}>
            <span aria-hidden="true" className="font-jp text-[13px] normal-case tracking-normal">
              鏡
            </span>
            {t("dashboard.lensLabel")}
          </legend>
          <div className="grid gap-2">
            {LENSES.map((opt) => {
              const active = lens === opt.id;
              const tone =
                opt.accent === "sakura"
                  ? "border-sakura/70 text-sakura"
                  : opt.accent === "moegi"
                    ? "border-moegi/70 text-moegi"
                    : "border-washi/40 text-washi";
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onLens(active ? null : opt.id)}
                  className={`flex min-h-11 items-center gap-3 rounded-xl border px-3.5 py-2 text-left transition ${
                    active ? `${tone} bg-ink-0/40` : "border-border text-washi-muted hover:text-washi"
                  }`}
                >
                  <span aria-hidden="true" className="font-jp text-base font-bold leading-none">
                    {opt.glyph}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{t(opt.labelKey)}</span>
                    <span className="block text-[13px] text-washi-dim">{t(opt.hintKey)}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] ${
                      active ? "border-current bg-current/15" : "border-border"
                    }`}
                  >
                    {active ? "✓" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* 選 · Selecting several series at once, which a long press on a
            cover starts too — named here, where a phone's other controls
            are, for the reader who never long-presses. */}
        {onSelectSeries && (
          <div>
            <p className={legend}>
              <span aria-hidden="true" className="font-jp text-[13px] normal-case tracking-normal">
                選
              </span>
              {t("bulk.regionLabel")}
            </p>
            <button
              type="button"
              onClick={onSelectSeries}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border px-3.5 py-2 text-left text-washi-muted transition hover:text-washi"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-washi">
                  {t("bulk.selectSeries")}
                </span>
                <span className="block text-[13px] text-washi-dim">
                  {t("bulk.selectHint")}
                </span>
              </span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        )}

        {tags.length > 0 && (
          <fieldset>
            <legend className={legend}>
              <span aria-hidden="true" className="font-jp text-[13px] normal-case tracking-normal">
                題
              </span>
              {t("dashboard.filterTitle")}
            </legend>
            {tags.length > 10 && (
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("dashboard.searchTags")}
                aria-label={t("dashboard.searchTags")}
                className="mb-3 w-full rounded-full border border-border bg-ink-2/60 px-4 py-2 text-sm text-washi placeholder:text-washi-dim focus:border-hanko/60 focus:outline-none focus:ring-2 focus:ring-hanko/30"
              />
            )}
            {shownTags.length === 0 ? (
              <p className="py-4 text-center text-sm text-washi-muted">
                {t("dashboard.searchNoMatch")}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {shownTags.map(({ name, count }) => {
                  const active = activeTags.has(name);
                  return (
                    <label
                      key={name}
                      className={`${chip} ${
                        active
                          ? "border-hanko/60 bg-hanko/15 text-washi"
                          : "border-border text-washi-muted hover:text-washi"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => onToggleTag(name)}
                        className="sr-only"
                      />
                      <span className="capitalize">{name}</span>
                      <span
                        className={`font-mono text-[11px] tabular-nums ${active ? "text-washi" : "text-washi-dim"}`}
                      >
                        {count}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>
        )}
      </div>
    </Sheet>
  );
}
