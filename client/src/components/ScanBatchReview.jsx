import { useState } from "react";
import Sheet from "@/components/ui/Sheet.jsx";

/**
 * 列 · The batch, reviewed: the tomes to mark owned (all ticked, one
 * action), the copies already on the shelf (a double, or nothing), the
 * strangers (one at a time through the add flow). A sheet, above the
 * camera — the top layer stacks it over the scanner's own dialog.
 */
export default function BatchReview({ open, onClose, queue, labelOf, marking, onMark, onCopy, onRemove, onAdd, onClear, t }) {
  const missing = queue.filter((i) => i.kind === "missing");
  const owned = queue.filter((i) => i.kind === "owned");
  const upcoming = queue.filter((i) => i.kind === "upcoming");
  const unknown = queue.filter((i) => i.kind === "unknown");
  const [unticked, setUnticked] = useState(() => new Set());
  const toMark = missing.filter((i) => !unticked.has(i.isbn));
  const toggle = (isbn) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(isbn)) next.delete(isbn);
      else next.add(isbn);
      return next;
    });

  const row = (item, action) => (
    <li key={item.isbn} className="flex min-w-0 items-center gap-3 py-2">
      {action}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-sm text-washi">{labelOf(item)}</span>
        <span className="block truncate font-mono text-[11px] text-washi-dim">
          {item.isbn}
          {item.matched === "catalogue" ? ` · ${t("scanPage.reviewViaCatalogue")}` : ""}
        </span>
      </span>
      <button
        type="button"
        onClick={() => onRemove(item.isbn)}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-washi-dim transition hover:text-hanko-bright pointer-coarse:h-11 pointer-coarse:w-11"
      >
        <span aria-hidden="true">×</span>
        <span className="sr-only">
          {t("scanPage.reviewRemove")} — {labelOf(item)}
        </span>
      </button>
    </li>
  );

  const heading = "mb-1 mt-5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-washi-dim first:mt-0";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      glyph="列"
      eyebrow={t("scanPage.reviewEyebrow")}
      title={t("scanPage.reviewTitle")}
      footer={
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClear}
            disabled={!queue.length}
            className="inline-flex min-h-11 items-center px-3 font-mono text-[11px] uppercase tracking-[0.18em] text-washi-muted transition hover:text-hanko-bright disabled:opacity-40"
          >
            {t("scanPage.reviewClear")}
          </button>
          <button
            type="button"
            onClick={() => onMark(toMark)}
            disabled={!toMark.length || marking}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full bg-hanko px-5 text-sm font-semibold text-on-hanko shadow-lg transition disabled:opacity-50"
          >
            {t("scanPage.reviewMark", { n: toMark.length })}
          </button>
        </div>
      }
    >
      {queue.length === 0 ? (
        <p className="py-6 text-center font-display text-sm italic text-washi-muted">
          {t("scanPage.reviewEmpty")}
        </p>
      ) : (
        <div>
          {missing.length > 0 && (
            <section aria-labelledby="batch-missing">
              <h3 id="batch-missing" className={heading}>
                <span aria-hidden="true" className="font-jp text-[13px] normal-case tracking-normal text-hanko-bright">印</span>
                {t("scanPage.reviewMissing")} · {missing.length}
              </h3>
              <ul className="divide-y divide-border/50">
                {missing.map((item) =>
                  row(
                    item,
                    <input
                      type="checkbox"
                      checked={!unticked.has(item.isbn)}
                      onChange={() => toggle(item.isbn)}
                      aria-label={labelOf(item)}
                      className="h-5 w-5 shrink-0 accent-[var(--hanko)]"
                    />,
                  ),
                )}
              </ul>
            </section>
          )}
          {unknown.length > 0 && (
            <section aria-labelledby="batch-unknown">
              <h3 id="batch-unknown" className={heading}>
                <span aria-hidden="true" className="font-jp text-[13px] normal-case tracking-normal">追</span>
                {t("scanPage.reviewUnknown")} · {unknown.length}
              </h3>
              <ul className="divide-y divide-border/50">
                {unknown.map((item) =>
                  row(
                    item,
                    <button
                      type="button"
                      onClick={() => onAdd(item)}
                      className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-border px-3 font-mono text-[11px] uppercase tracking-wider text-washi-muted transition hover:text-washi pointer-coarse:min-h-11"
                    >
                      {t("scanPage.reviewAdd")}
                      <span className="sr-only"> — {labelOf(item)}</span>
                    </button>,
                  ),
                )}
              </ul>
            </section>
          )}
          {upcoming.length > 0 && (
            <section aria-labelledby="batch-upcoming">
              <h3 id="batch-upcoming" className={heading}>
                <span aria-hidden="true" className="font-jp text-[13px] normal-case tracking-normal text-moegi">来</span>
                {t("scanPage.reviewUpcoming")} · {upcoming.length}
              </h3>
              <p className="mb-1 font-display text-[13px] italic text-washi-dim">
                {t("scanPage.reviewUpcomingNote")}
              </p>
              <ul className="divide-y divide-border/50">
                {upcoming.map((item) =>
                  row(
                    item,
                    <span className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-moegi/40 bg-moegi/10 px-3 font-mono text-[11px] tabular-nums text-moegi">
                      {new Date(item.volume.release_date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                    </span>,
                  ),
                )}
              </ul>
            </section>
          )}
          {owned.length > 0 && (
            <section aria-labelledby="batch-owned">
              <h3 id="batch-owned" className={heading}>
                <span aria-hidden="true" className="font-jp text-[13px] normal-case tracking-normal text-moegi">済</span>
                {t("scanPage.reviewOwned")} · {owned.length}
              </h3>
              <ul className="divide-y divide-border/50">
                {owned.map((item) =>
                  row(
                    item,
                    <button
                      type="button"
                      onClick={() => onCopy(item)}
                      title={t("scanPage.addCopyHint")}
                      className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-gold/40 bg-gold/10 px-3 font-mono text-[11px] uppercase tracking-wider text-gold transition hover:bg-gold/20 pointer-coarse:min-h-11"
                    >
                      {t("scanPage.addCopy", { n: 2 + (Number(item.volume?.extra_copies) || 0) })}
                      <span className="sr-only"> — {labelOf(item)}</span>
                    </button>,
                  ),
                )}
              </ul>
            </section>
          )}
        </div>
      )}
    </Sheet>
  );
}
