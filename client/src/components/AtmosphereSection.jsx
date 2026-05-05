import { useAtmosphere } from "@/hooks/useAtmosphere.js";
import { useT } from "@/i18n/index.jsx";

export default function AtmosphereSection() {
  const t = useT();
  const { enabled, setEnabled } = useAtmosphere();

  return (
    <section
      className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up"
      style={{ animationDelay: "240ms" }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-moegi/20 font-jp text-[10px] font-bold text-moegi"
          >
            風
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-washi">
              {t("settings.atmosphereTitle")}
            </h2>
            <p className="mt-1 text-xs text-washi-muted">
              {t("settings.atmosphereBody")}
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t("settings.atmosphereToggleAria")}
          onClick={() => setEnabled(!enabled)}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition ${
            enabled
              ? "border-moegi bg-moegi/80"
              : "border-border bg-ink-2"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
              enabled
                ? "left-[calc(100%_-_1.375rem)] bg-ink-0 shadow-md"
                : "left-0.5 bg-washi-dim"
            }`}
          />
        </button>
      </div>

      <p className="mt-2 rounded-lg border border-border bg-ink-0/40 px-3 py-2 text-[11px] leading-relaxed text-washi-muted">
        <span className="font-mono uppercase tracking-[0.2em] text-washi-dim">
          {t("settings.atmosphereGatingLabel")}
        </span>{" "}
        {t("settings.atmosphereGatingDetail")}
      </p>
    </section>
  );
}
