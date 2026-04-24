import { useSeason } from "@/hooks/useSeason.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 季節 · Settings section — pick a seasonal palette override.
 *
 * Six choices: Auto (resolves from month), the four Japanese seasons,
 * and Neutral (base palette, no shift). Rendered as a row of stamp-
 * style chips, each tinted in the shift the option would apply so the
 * choice is self-explanatory without opening the live preview.
 */
export default function SeasonSection() {
  const t = useT();
  const { preference, current, setPreference } = useSeason();

  const options = [
    { id: "auto", kanji: "暦", tint: "auto" },
    { id: "spring", kanji: "春", tint: "spring" },
    { id: "summer", kanji: "夏", tint: "summer" },
    { id: "autumn", kanji: "秋", tint: "autumn" },
    { id: "winter", kanji: "冬", tint: "winter" },
    { id: "neutral", kanji: "素", tint: "neutral" },
  ];

  return (
    <section
      className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up"
      style={{ animationDelay: "220ms" }}
    >
      <div className="mb-4 flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid h-5 w-5 place-items-center rounded-full bg-sakura/20 font-jp text-[10px] font-bold text-sakura"
        >
          季
        </span>
        <div>
          <h2 className="font-display text-lg font-semibold text-washi">
            {t("settings.seasonTitle")}
          </h2>
          <p className="mt-1 text-xs text-washi-muted">
            {preference === "auto"
              ? t("settings.seasonBodyAuto", {
                  current: t(`settings.seasonName.${current ?? "neutral"}`),
                })
              : t("settings.seasonBody")}
          </p>
        </div>
      </div>

      <div
        role="radiogroup"
        aria-label={t("settings.seasonTitle")}
        className="grid grid-cols-3 gap-2 sm:grid-cols-6"
      >
        {options.map((opt) => {
          const active = preference === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setPreference(opt.id)}
              className={`season-chip season-chip-${opt.tint} group relative flex flex-col items-center gap-1 overflow-hidden rounded-lg border px-2 py-3 transition ${
                active
                  ? "season-chip-active border-washi/30"
                  : "border-border hover:border-washi/20"
              }`}
            >
              <span
                aria-hidden="true"
                className="font-jp text-2xl font-bold leading-none"
                style={{ transform: "rotate(-3deg)" }}
              >
                {opt.kanji}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-washi-muted">
                {t(`settings.seasonName.${opt.id}`)}
              </span>
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-hanko shadow-[0_0_4px_var(--hanko-glow)]"
                />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
