import { useT } from "@/i18n/index.jsx";

/**
 * LibraryBlock — 蔵書 (zōsho, "books conserved").
 *
 * Unified collection+reading panel that replaces the two separate blocks
 * (old "Collection" stats + emaki progress) we had before. Three chips
 * (印 possédés / 読 lus / 積 en attente) express every count the user
 * cares about at a glance, and the emaki scroll below gives the per-tome
 * interactive layer. The total-volumes editor is hosted here during edit
 * mode so the whole "library size + state" concept lives in one place.
 *
 * The emaki itself is unchanged from the v1 implementation:
 *
 *   ┃▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░       ┃
 *    └──────── read ─────┘└ owned ┘└ missing ┘
 *     1          51          101
 *
 * With a "reading-head" ink-drop floating above the last-read position
 * and click-zones that scroll to the matching Volume card below.
 */
export default function LibraryBlock({
  volumes,
  volumesOwned,
  totalVolumes,
  isEditing,
  setTotalVolumes,
}) {
  const t = useT();
  const byNum = new Map();
  for (const v of volumes ?? []) {
    byNum.set(v.vol_num, v);
  }
  let readCount = 0;
  let tsundokuCount = 0;
  let lastReadNum = 0;
  const cells = [];
  for (let n = 1; n <= totalVolumes; n++) {
    const v = byNum.get(n);
    let state = "missing";
    if (v?.read_at) {
      state = "read";
      readCount += 1;
      if (n > lastReadNum) lastReadNum = n;
    } else if (v?.owned) {
      state = "tsundoku";
      tsundokuCount += 1;
    }
    cells.push({ num: n, state, readAt: v?.read_at });
  }
  // Division-by-zero guard: `totalVolumes = 0` produces NaN which
  // then renders as "NaN%" in LibraryChip and trashed styles via
  // width: `${NaN}%`. Happens when a series is freshly created with
  // an unknown volume total.
  const percent =
    totalVolumes > 0 ? Math.round((readCount / totalVolumes) * 100) : 0;

  // Decade ticks + labels. For short series (<=40) we draw every-10 ticks
  // + every-10 labels; for longer series we space labels every 25 or 50
  // to keep the strip uncluttered.
  const labelStep = totalVolumes <= 40 ? 10 : totalVolumes <= 100 ? 25 : 50;
  const decadeMarks = [];
  for (let n = labelStep; n < totalVolumes; n += labelStep) {
    decadeMarks.push(n);
  }
  // Minor tick marks (every 10) — drawn subtler than the labeled ones.
  const minorTicks = [];
  if (totalVolumes > 20) {
    for (let n = 10; n < totalVolumes; n += 10) {
      if (!decadeMarks.includes(n)) minorTicks.push(n);
    }
  }

  const scrollToVolume = (num) => {
    const el = document.querySelector(`[data-vol-num="${num}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const card = el.closest(".group");
    if (card) {
      card.classList.add("ring-flash");
      setTimeout(() => card.classList.remove("ring-flash"), 1600);
    }
  };

  // Helper: turn vol_num into % position on the strip. Each tome occupies
  // (1/totalVolumes) of the width, so tome N is centred at (N-0.5)/total.
  const posPercent = (num) => ((num - 0.5) / totalVolumes) * 100;

  const ownedPercent =
    totalVolumes > 0 ? Math.round((volumesOwned / totalVolumes) * 100) : 0;

  return (
    <div className="mt-8 rounded-2xl border border-border bg-ink-1/40 p-5 backdrop-blur animate-fade-up">
      {/* Eyebrow + global reading percent — the percent is the most
          "where I'm at" signal for this series. */}
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
          {t("manga.libraryLabel")}
        </p>
        {totalVolumes > 0 && (
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-muted tabular-nums">
            {percent}
            <span className="text-washi-dim">% 読破</span>
          </p>
        )}
      </div>

      {/* Three-chips header — replaces the old redundant "N / M" + "%"
          big stats. Each chip pairs a kanji sigil with its count, so the
          user can read the three dimensions of the library state in
          parallel. `/ total` in smaller ink-dim to keep the focus on the
          salient numerator. */}
      <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
        <LibraryChip
          kanji="印"
          label={t("manga.ownedChip")}
          value={volumesOwned}
          total={totalVolumes}
          percent={ownedPercent}
          accent="hanko"
        />
        <LibraryChip
          kanji="読"
          label={t("manga.readChip")}
          value={readCount}
          total={totalVolumes}
          percent={percent}
          accent="moegi"
        />
        <LibraryChip
          kanji="積"
          label={t("manga.tsundokuChipShort")}
          value={tsundokuCount}
          accent="washi"
        />
      </div>

      {/* Emaki strip — only rendered when we know how many tomes the
          series has. Otherwise we just show the chips + the edit input. */}
      {totalVolumes > 0 && (
      <div className="relative mt-8 px-3" role="group" aria-label={t("manga.readingAria", { read: readCount, total: totalVolumes })}>
        {/* Reading head (pic d'encre) — floats above the strip at the
            last-read position. Hidden gracefully when no tome read yet. */}
        {lastReadNum > 0 && (
          <div
            className="emaki-head pointer-events-none absolute -top-6 -translate-x-1/2"
            style={{ left: `calc(${posPercent(lastReadNum)}% + 0px)` }}
          >
            <span
              className="font-jp text-[10px] leading-none tabular-nums"
              title={t("manga.readingHeadTitle", { n: lastReadNum })}
            >
              読 · {lastReadNum}
            </span>
            <span className="emaki-dot" aria-hidden="true" />
            <span className="emaki-halo" aria-hidden="true" />
          </div>
        )}

        {/* Left scroll-rod — the bamboo stick of the emaki */}
        <span
          aria-hidden="true"
          className="emaki-rod emaki-rod-left"
        />
        {/* Right scroll-rod */}
        <span
          aria-hidden="true"
          className="emaki-rod emaki-rod-right"
        />

        {/* The strip itself — paper surface, with state segments stacked
            on top via absolute positioning. */}
        <div className="emaki-strip relative h-4 animate-emaki-unroll">
          {/* State segments — one absolute div per tome position.
              - read: moegi gradient (horizontal, continuous across all
                read cells via matched background-size + position)
              - tsundoku: washi-dim rayé (solid pattern, no gradient)
              - missing: transparent (lets the paper surface show) */}
          {cells.map((cell) => {
            const style = {
              left: `${((cell.num - 1) / totalVolumes) * 100}%`,
              width: `${(1 / totalVolumes) * 100}%`,
            };
            if (cell.state === "read" && totalVolumes > 1) {
              // Stretch the gradient to the full strip width, then offset
              // so each cell shows only its own slice. Formula:
              //   size = totalVolumes * 100% (stretches gradient over N cells)
              //   position-x = (n-1) / (N-1) * 100%  (slides to the cell's slot)
              style.backgroundSize = `${totalVolumes * 100}% 100%`;
              style.backgroundPosition = `${
                ((cell.num - 1) * 100) / (totalVolumes - 1)
              }% center`;
            }
            return (
              <div
                key={cell.num}
                className={`emaki-cell emaki-cell-${cell.state}`}
                style={style}
                aria-hidden="true"
              />
            );
          })}

          {/* Minor decade ticks — every-10 marks, very subtle */}
          {minorTicks.map((n) => (
            <span
              key={`tick-${n}`}
              aria-hidden="true"
              className="emaki-tick emaki-tick-minor"
              style={{ left: `${(n / totalVolumes) * 100}%` }}
            />
          ))}
          {/* Major labelled marks */}
          {decadeMarks.map((n) => (
            <span
              key={`mark-${n}`}
              aria-hidden="true"
              className="emaki-tick emaki-tick-major"
              style={{ left: `${(n / totalVolumes) * 100}%` }}
            />
          ))}
        </div>

        {/* Invisible click grid — one zone per tome. Takes the full strip
            width, stacked over everything. `flex-1` gives equal zones. */}
        <div className="absolute inset-0 flex">
          {cells.map((cell) => (
            <button
              key={cell.num}
              type="button"
              onClick={() => scrollToVolume(cell.num)}
              title={
                cell.state === "read"
                  ? t("manga.readingCellRead", {
                      n: cell.num,
                      date: cell.readAt
                        ? new Date(cell.readAt).toLocaleDateString()
                        : "",
                    })
                  : cell.state === "tsundoku"
                    ? t("manga.readingCellTsundoku", { n: cell.num })
                    : t("manga.readingCellMissing", { n: cell.num })
              }
              aria-label={t(`manga.readingAriaCell.${cell.state}`, {
                n: cell.num,
              })}
              className="emaki-hit flex-1 focus:outline-none"
            />
          ))}
        </div>

        {/* Decade labels row, under the strip */}
        <div className="relative mt-2 h-4 font-mono text-[9px] font-semibold uppercase tracking-widest text-washi-dim tabular-nums">
          <span className="absolute left-0 -translate-x-1/2">1</span>
          {decadeMarks.map((n) => (
            <span
              key={`lbl-${n}`}
              className="absolute -translate-x-1/2"
              style={{ left: `${(n / totalVolumes) * 100}%` }}
            >
              {n}
            </span>
          ))}
          <span className="absolute right-0 translate-x-1/2">
            {totalVolumes}
          </span>
        </div>
      </div>
      )}

      {/* Total-volumes editor — moved here from the old Collection block
          now that the two blocks are merged. Only rendered in edit mode;
          sits below the emaki so it doesn't interrupt the visual when
          viewing. */}
      {isEditing && (
        <div className="mt-5 border-t border-border pt-4">
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim">
            {t("manga.totalVolumes")}
          </label>
          <input
            type="number"
            value={totalVolumes}
            onChange={(e) => setTotalVolumes(Number(e.target.value))}
            min="0"
            className="w-full rounded-lg border border-border bg-ink-1 px-3 py-2 text-sm text-washi focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
          />
        </div>
      )}
    </div>
  );
}

/**
 * LibraryChip — one of the three stat chips (印 / 読 / 積) inside the
 * unified LibraryBlock header. Pairs a Noto Serif JP kanji with a
 * tabular count + optional "/ total" denominator and a small footnote.
 */
function LibraryChip({ kanji, label, value, total, percent, accent }) {
  const colour =
    accent === "hanko"
      ? "text-hanko-bright"
      : accent === "moegi"
        ? "text-moegi"
        : "text-washi";
  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-ink-2/40 px-3 py-2.5 transition hover:border-hanko/30 sm:px-4">
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden="true"
          className={`font-jp text-lg leading-none ${colour}`}
        >
          {kanji}
        </span>
        <span
          className={`font-display text-2xl font-semibold tabular-nums ${colour}`}
        >
          {value}
        </span>
        {total != null && (
          <span className="font-display text-sm italic text-washi-dim tabular-nums">
            / {total}
          </span>
        )}
      </div>
      <p className="mt-0.5 flex items-baseline gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-washi-dim">
        <span>{label}</span>
        {percent != null && total > 0 && (
          <span className="text-washi-muted tabular-nums">· {percent}%</span>
        )}
      </p>
    </div>
  );
}
