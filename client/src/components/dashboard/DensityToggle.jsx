import { useT } from "@/i18n/index.jsx";
import { useGridDensity } from "@/hooks/useGridDensity.js";
import { DENSITIES } from "@/lib/gridDensity.js";

const GLYPH = { comfortable: "疎", dense: "密" };

/**
 * 密 · Two shelf depths. Hidden below `sm`: on a phone the difference is
 * one cover per row, and the toolbar has better uses for the space.
 */
export default function DensityToggle() {
  const t = useT();
  const { density, setDensity } = useGridDensity();

  return (
    <div
      role="radiogroup"
      aria-label={t("dashboard.densityLabel")}
      className="hidden items-stretch overflow-hidden rounded-full border border-border bg-ink-1/60 p-0.5 sm:inline-flex"
    >
      {DENSITIES.map((id) => {
        const active = density === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setDensity(id)}
            title={t(`dashboard.density_${id}`)}
            className={`grid h-9 w-9 place-items-center rounded-full font-jp text-[15px] leading-none transition ${
              active
                ? "bg-gold/15 text-gold"
                : "text-washi-dim hover:text-washi"
            }`}
          >
            <span aria-hidden="true">{GLYPH[id]}</span>
            <span className="sr-only">{t(`dashboard.density_${id}`)}</span>
          </button>
        );
      })}
    </div>
  );
}
