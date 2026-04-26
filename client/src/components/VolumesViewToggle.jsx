import { useT } from "@/i18n/index.jsx";
import { useVolumesView } from "@/hooks/useVolumesView.js";

/**
 * 帳 vs 棚 · Two-segment toggle for the volumes view mode.
 *
 * Visual language:
 *   - The two kanji share the radical 巾 (cloth/strip) — they sit
 *     beside each other as a graphic pair, not as adversaries.
 *   - Active segment carries the hanko-bright accent + a tiny dot to
 *     read as "this is selected" without relying on contrast alone
 *     (color-blind safe).
 *   - Hover bumps the inactive kanji toward washi for a subtle
 *     "you can pick me" cue.
 *
 * Lives in the volumes-section header on MangaPage. Width is tight
 * (auto, content-driven) so it tucks beside the volume count and the
 * Coffret CTA without breaking the line.
 */
export default function VolumesViewToggle() {
  const t = useT();
  const { mode, setMode } = useVolumesView();

  const options = [
    { id: "ledger", kanji: "帳" },
    { id: "shelf", kanji: "棚" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t("manga.viewToggleLabel")}
      className="inline-flex items-stretch overflow-hidden rounded-full border border-border bg-ink-1/40 p-0.5"
    >
      {options.map((opt) => {
        const active = mode === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setMode(opt.id)}
            title={t(`manga.viewMode.${opt.id}`)}
            className={`group relative inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider transition ${
              active
                ? "bg-hanko/20 text-hanko-bright"
                : "text-washi-muted hover:text-washi"
            }`}
          >
            <span
              aria-hidden="true"
              className={`font-jp text-base font-bold leading-none transition ${
                active ? "text-hanko-bright" : "text-washi-dim group-hover:text-washi"
              }`}
              style={{ transform: active ? "rotate(-3deg)" : "rotate(0deg)" }}
            >
              {opt.kanji}
            </span>
            <span className="hidden sm:inline">
              {t(`manga.viewMode.${opt.id}`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
