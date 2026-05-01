import { useT } from "@/i18n/index.jsx";
import { useVolumesView } from "@/hooks/useVolumesView.js";

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
            // Plain `setMode` — no `withViewTransition` here. The
            // hero cover at the top of MangaPage carries a
            // `view-transition-name: cover-{mal_id}` so the
            // Dashboard ↔ MangaPage morph works. Triggering a VT for
            // an in-page state change (the toggle below) would also
            // hoist that cover into the overlay pseudo-layer for
            // ~250ms, which (a) raises the cover above the page
            // header and (b) breaks the masthead's `backdrop-blur`
            // because its filter source moves out of its compositing
            // context — the title behind the blur briefly bleeds
            // through. Cross-fade between view modes simply isn't
            // worth that flicker; an instant swap is the correct
            // local choice.
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
