import SeasonSection from "@/components/SeasonSection.jsx";
import AtmosphereSection from "@/components/AtmosphereSection.jsx";
import { ACCENTS } from "@/lib/accent.js";
import { Card, CardHeader, Chapter, RadioCard, SubBlock } from "./_shared.jsx";

export default function ChapterAppearance({
  chapter,
  subBlocks,
  t,
  themeOptions,
  theme,
  onThemeChange,
  accentColor,
  onAccentChange,
  shelf3d,
  onShelf3dChange,
  soundEnabled,
  onSoundChange,
  hapticsOn,
  onHapticsToggle,
}) {
  // ─── Ch. 1 · Apparence ─────────────────────────────────
  // Three sub-blocks ordered by sensory channel:
  //   視 Visuel    — what the eye sees first (theme, accent, 3D)
  //   雰 Ambiance  — environmental layers (season, particles)
  //   響 Retours   — what your senses feel back (sound + haptic)
  // Sound + Haptics used to live in the visual chapter as a
  // flat afterthought; grouping them as 響 Retours surfaces
  // their shared semantics and gets them out of the way of
  // actual visual settings.
  return (
    <Chapter
      id="appearance"
      chapter={chapter}
      title={t("settings.tabAppearance")}
      subtitle={t("settings.tabAppearanceHint")}
      t={t}
    >
      <SubBlock block={subBlocks.visual} t={t}>
        <ThemeSection
          options={themeOptions}
          value={theme}
          onChange={onThemeChange}
          t={t}
        />
        <AccentSection
          value={accentColor}
          onChange={onAccentChange}
          t={t}
        />
        <Shelf3DSection
          enabled={shelf3d}
          onToggle={onShelf3dChange}
          t={t}
        />
      </SubBlock>

      <SubBlock block={subBlocks.atmosphere} t={t}>
        <SeasonSection />
        <AtmosphereSection />
      </SubBlock>

      <SubBlock block={subBlocks.feedback} t={t}>
        <SoundSection
          enabled={soundEnabled}
          onToggle={onSoundChange}
          t={t}
        />
        <HapticsSection
          enabled={hapticsOn}
          onToggle={onHapticsToggle}
          t={t}
        />
      </SubBlock>
    </Chapter>
  );
}

function ThemeSection({ options, value, onChange, t }) {
  return (
    <Card>
      <CardHeader
        title={t("settings.appearance")}
        body={t("settings.appearanceBody")}
      />
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((opt) => (
          <RadioCard
            key={opt.value}
            name="theme"
            value={opt.value}
            checked={value === opt.value}
            onClick={() => onChange(opt.value)}
          >
            <div className="flex items-center gap-2.5">
              <ThemeSwatch value={opt.value} />
              <div className="min-w-0 flex-1">
                <p
                  className={`font-display text-sm font-semibold ${
                    value === opt.value ? "text-hanko-bright" : "text-washi"
                  }`}
                >
                  {opt.label}
                </p>
                <p className="mt-0.5 text-[10px] leading-tight text-washi-muted">
                  {opt.description}
                </p>
              </div>
            </div>
          </RadioCard>
        ))}
      </div>
    </Card>
  );
}

function AccentSection({ value, onChange, t }) {
  return (
    <section
      className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up"
      style={{ animationDelay: "180ms" }}
    >
      <div className="mb-4 flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-hanko/20 font-jp text-[10px] font-bold text-hanko-bright"
        >
          朱
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-washi">
            {t("settings.accentTitle")}
          </h2>
          <p className="mt-1 text-xs text-washi-muted">
            {t("settings.accentBody")}
          </p>
        </div>
      </div>

      {/*
        4-up grid on mobile, 8-up on lg so the full palette fits in a
        single row when the viewport allows. Each chip is a vertical
        column of: kanji glyph at large size (the hook), swatch dot,
        latin label.

        Selection treatment: ring in the chosen accent's own colour
        + raised z to break out of the grid plane. The kanji also
        gets `text-hanko-bright` once selected so the rest of the UI
        previews as a coherent palette.
      */}
      <div
        role="radiogroup"
        aria-label={t("settings.accentTitle")}
        className="grid grid-cols-4 gap-2 sm:grid-cols-8"
      >
        {ACCENTS.map((opt) => {
          const active = value === opt.name;
          return (
            <button
              key={opt.name}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.name)}
              title={opt.description}
              className={`group relative flex aspect-[3/4] flex-col items-center justify-between rounded-xl border bg-ink-0/40 p-2 transition-all ${
                active
                  ? "border-transparent ring-2 shadow-[0_8px_22px_-8px_rgba(0,0,0,0.6)] -translate-y-0.5"
                  : "border-border hover:border-border/80 hover:-translate-y-0.5"
              }`}
              style={
                active
                  ? {
                      // Set the ring colour from the accent swatch
                      // so the picker's own visual selection state
                      // aligns with what the rest of the app will
                      // become on confirm. Inline because Tailwind
                      // can't synthesise dynamic OKLCH classes.
                      "--tw-ring-color": opt.swatch,
                    }
                  : undefined
              }
            >
              <span
                aria-hidden="true"
                className={`font-jp text-2xl font-bold leading-none transition-colors ${
                  active ? "text-washi" : "text-washi-dim group-hover:text-washi"
                }`}
              >
                {opt.kanji}
              </span>
              <span
                aria-hidden="true"
                className="h-3 w-3 rounded-full ring-1 ring-washi/15"
                style={{ backgroundColor: opt.swatch }}
              />
              <span
                className={`font-mono text-[9px] uppercase tracking-[0.2em] transition-colors ${
                  active ? "text-washi" : "text-washi-dim"
                }`}
              >
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Shelf3DSection({ enabled, onToggle, t }) {
  return (
    <section
      className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up"
      style={{ animationDelay: "210ms" }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-hanko/20 font-jp text-[10px] font-bold text-hanko-bright"
          >
            棚
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-washi">
              {t("settings.shelf3dTitle")}
            </h2>
            <p className="mt-1 text-xs text-washi-muted">
              {t("settings.shelf3dBody")}
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t("settings.shelf3dToggleAria")}
          onClick={() => onToggle(!enabled)}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hanko/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-1 ${
            enabled
              ? "border-hanko bg-hanko/80"
              : "border-border bg-ink-2"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
              enabled
                ? "left-[calc(100%-1.375rem)] bg-ink-0 shadow-md"
                : "left-0.5 bg-washi-dim"
            }`}
          />
        </button>
      </div>
    </section>
  );
}

function SoundSection({ enabled, onToggle, t }) {
  return (
    <section
      className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up"
      style={{ animationDelay: "360ms" }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gold/20 font-jp text-[10px] font-bold text-gold"
          >
            音
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-washi">
              {t("settings.soundTitle")}
            </h2>
            <p className="mt-1 text-xs text-washi-muted">
              {t("settings.soundBody")}
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t("settings.soundToggleAria")}
          onClick={() => onToggle(!enabled)}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-1 ${
            enabled
              ? "border-gold bg-gold/80"
              : "border-border bg-ink-2"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
              enabled
                ? "left-[calc(100%-1.375rem)] bg-ink-0 shadow-md"
                : "left-0.5 bg-washi-dim"
            }`}
          />
        </button>
      </div>

      <p className="mt-2 rounded-lg border border-border bg-ink-0/40 px-3 py-2 text-[11px] leading-relaxed text-washi-muted">
        <span className="font-mono uppercase tracking-[0.2em] text-washi-dim">
          {t("settings.soundGatingLabel")}
        </span>{" "}
        {t("settings.soundGatingDetail")}
      </p>
    </section>
  );
}

function HapticsSection({ enabled, onToggle, t }) {
  return (
    <section
      className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up"
      style={{ animationDelay: "300ms" }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-hanko/20 font-jp text-[10px] font-bold text-hanko-bright"
          >
            振
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-washi">
              {t("settings.hapticsTitle")}
            </h2>
            <p className="mt-1 text-xs text-washi-muted">
              {t("settings.hapticsBody")}
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t("settings.hapticsToggleAria")}
          onClick={() => onToggle(!enabled)}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hanko/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-1 ${
            enabled
              ? "border-hanko bg-hanko/80"
              : "border-border bg-ink-2"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
              enabled
                ? "left-[calc(100%-1.375rem)] bg-ink-0 shadow-md"
                : "left-0.5 bg-washi-dim"
            }`}
          />
        </button>
      </div>

      <p className="mt-2 rounded-lg border border-border bg-ink-0/40 px-3 py-2 text-[11px] leading-relaxed text-washi-muted">
        <span className="font-mono uppercase tracking-[0.2em] text-washi-dim">
          {t("settings.hapticsGatingLabel")}
        </span>{" "}
        {t("settings.hapticsGatingDetail")}
      </p>
    </section>
  );
}

// Tiny visual swatch — two tones + a hanko dot — used by the theme picker.
function ThemeSwatch({ value }) {
  if (value === "auto") {
    return (
      <span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-border">
        <span
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, oklch(0.08 0.005 30) 0% 50%, oklch(0.98 0.008 85) 50% 100%)",
          }}
        />
        <span
          className="relative h-2 w-2 rounded-full"
          style={{ background: "oklch(0.6 0.22 25)" }}
        />
      </span>
    );
  }

  const bg = value === "dark" ? "oklch(0.11 0.008 30)" : "oklch(0.95 0.012 82)";
  const border =
    value === "dark"
      ? "oklch(0.96 0.012 85 / 0.1)"
      : "oklch(0.2 0.012 40 / 0.14)";
  const text =
    value === "dark" ? "oklch(0.96 0.012 85)" : "oklch(0.2 0.012 40)";

  return (
    <span
      className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg border"
      style={{ background: bg, borderColor: border }}
    >
      <span
        className="font-display text-[11px] font-semibold italic"
        style={{ color: text }}
      >
        Aa
      </span>
      <span
        className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full"
        style={{
          background:
            value === "dark" ? "oklch(0.6 0.22 25)" : "oklch(0.52 0.22 25)",
        }}
      />
    </span>
  );
}
