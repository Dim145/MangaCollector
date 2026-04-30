import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Modal from "@/components/ui/Modal.jsx";
import Skeleton from "@/components/ui/Skeleton.jsx";
// 削除 · GDPR erasure flow lives behind a lazy chunk so its 550 lines never
// touch the wire on a regular Settings visit.
const DeleteAccountFlow = lazy(() =>
  import("@/components/DeleteAccountFlow.jsx"),
);
import PublicProfileSection from "@/components/PublicProfileSection.jsx";
import BirthdayModeSection from "@/components/BirthdayModeSection.jsx";
import ArchiveSection from "@/components/ArchiveSection.jsx";
import SeasonSection from "@/components/SeasonSection.jsx";
import AtmosphereSection from "@/components/AtmosphereSection.jsx";
import WelcomeTour from "@/components/WelcomeTour.jsx";
import { resetTourSeen } from "@/lib/tour.js";
import { useOnline } from "@/hooks/useOnline.js";
import { usePendingCount } from "@/hooks/usePendingCount.js";
import { useUpdateSettings, useUserSettings } from "@/hooks/useSettings.js";
import { forceResyncFromServer, notifySyncError, notifySyncInfo } from "@/lib/sync.js";
import { getApiKey, setApiKey } from "@/lib/isbn.js";
import { getHapticsEnabled, haptics, setHapticsEnabled } from "@/lib/haptics.js";
import { setSoundEnabled } from "@/lib/sounds.js";
import { formatCurrency } from "@/utils/price.js";
import { LANGUAGES, useT } from "@/i18n/index.jsx";

const ADULT_OPTION_VALUES = [
  { value: 0, key: "Blur" },
  { value: 1, key: "Hide" },
  { value: 2, key: "Show" },
];

const TITLE_OPTION_VALUES = [
  { value: "Default", key: "Default" },
  { value: "English", key: "English" },
  { value: "Japanese", key: "Japanese" },
];

const THEME_OPTION_VALUES = [
  { value: "dark", key: "Dark" },
  { value: "light", key: "Light" },
  { value: "auto", key: "Auto" },
];

const CURRENCIES = [
  { code: "USD", key: "USD", flag: "🇺🇸" },
  { code: "EUR", key: "EUR", flag: "🇪🇺" },
];

// Mirror of the server's currency formatter so a switch hydrates the symbol
// immediately, instead of degrading to "$" until the next /api/user/settings
// round-trip.
const CURRENCY_FORMATS = {
  USD: { code: "USD", symbol: "$", separator: ",", decimal: ".", precision: 2, format: "!#", negative_pattern: "-!#" },
  EUR: { code: "EUR", symbol: "€", separator: " ", decimal: ",", precision: 2, format: "#!", negative_pattern: "-#!" },
};

// 章 · The four chapters of the settings tome. Each chapter pairs a
// thematic kanji glyph with an ordinal — `kanjiNum` is the CJK numeral
// that surfaces in the hanko stamp and the index rail.
const CHAPTERS = [
  { id: "appearance", kanji: "風", kanjiNum: "一", labelKey: "settings.tabAppearance", hintKey: "settings.tabAppearanceHint" },
  { id: "content",    kanji: "文", kanjiNum: "二", labelKey: "settings.tabContent",    hintKey: "settings.tabContentHint" },
  { id: "account",    kanji: "館", kanjiNum: "三", labelKey: "settings.tabAccount",    hintKey: "settings.tabAccountHint" },
  { id: "advanced",   kanji: "危", kanjiNum: "四", labelKey: "settings.tabAdvanced",   hintKey: "settings.tabAdvancedHint" },
];
const VALID_IDS = new Set(CHAPTERS.map((c) => c.id));

export default function SettingsPage() {
  const { data: settings, isInitialLoad: settingsLoading } = useUserSettings();
  const updateSettings = useUpdateSettings();
  const online = useOnline();
  const pending = usePendingCount();
  const t = useT();

  const ADULT_OPTIONS = ADULT_OPTION_VALUES.map((o) => ({
    value: o.value,
    label: t(`settings.adult${o.key}`),
    description: t(`settings.adult${o.key}Desc`),
  }));
  const TITLE_OPTIONS = TITLE_OPTION_VALUES.map((o) => ({
    value: o.value,
    label: t(`settings.title${o.key}`),
  }));
  const THEME_OPTIONS = THEME_OPTION_VALUES.map((o) => ({
    value: o.value,
    label: t(`settings.theme${o.key}`),
    description: t(`settings.theme${o.key}Desc`),
  }));

  const [showAdultContent, setShowAdultContent] = useState(0);
  const [currencyObject, setCurrencyObject] = useState(null);
  const [titleType, setTitleType] = useState("Default");
  const [theme, setTheme] = useState("dark");
  const [language, setLanguage] = useState("en");
  const [soundEnabled, setSoundEnabledState] = useState(false);
  const [saved, setSaved] = useState(false);

  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState(null);
  const [restoreDone, setRestoreDone] = useState(false);

  const [deleteFlowOpen, setDeleteFlowOpen] = useState(false);

  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyRevealed, setApiKeyRevealed] = useState(false);
  const [apiKeySaved, setApiKeySaved] = useState(false);

  // 振 · Haptics is a localStorage-only preference (device-specific —
  // see lib/haptics.js for the rationale). Lazy initialiser reads the
  // flag once at mount; toggles below write through and fire a buzz so
  // the user feels what they just enabled.
  const [hapticsOn, setHapticsOn] = useState(getHapticsEnabled);

  const handleHapticsToggle = (next) => {
    setHapticsOn(next);
    setHapticsEnabled(next);
    if (next) haptics.success();
  };

  // Scroll-spy: which chapter is currently in view (drives the index
  // rail's active state + writes back to the URL hash).
  const [activeChapter, setActiveChapter] = useState(() => {
    if (typeof window === "undefined") return CHAPTERS[0].id;
    const hash = window.location.hash.slice(1);
    return VALID_IDS.has(hash) ? hash : CHAPTERS[0].id;
  });

  // Scroll-into-view helper. Each chapter section carries a
  // `scroll-margin-top` so the smooth scroll lands BELOW the sticky
  // header / mobile ribbon rather than tucking the title underneath.
  const goToChapter = useCallback((id) => {
    const node = document.getElementById(`ch-${id}`);
    if (!node) return;
    setActiveChapter(id);
    if (typeof window !== "undefined" && window.history?.replaceState) {
      window.history.replaceState(null, "", `#${id}`);
    }
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // On first paint, if the URL came in with a valid hash, jump to it.
  // We delay one frame so the chapter DOM is mounted before scrollIntoView.
  const jumpedRef = useRef(false);
  useEffect(() => {
    if (jumpedRef.current || settingsLoading) return;
    const hash = window.location.hash.slice(1);
    if (VALID_IDS.has(hash)) {
      requestAnimationFrame(() => {
        document.getElementById(`ch-${hash}`)?.scrollIntoView({ block: "start" });
      });
    }
    jumpedRef.current = true;
  }, [settingsLoading]);

  // Seed local state from the server ONCE — a background refetch arriving
  // mid-click would otherwise reset an in-progress selection.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!settings || seededRef.current) return;
    setShowAdultContent(settings?.adult_content_level || 0);
    setCurrencyObject(settings?.currency);
    setTitleType(settings?.titleType || "Default");
    setTheme(settings?.theme || "dark");
    setLanguage(settings?.language || "en");
    setSoundEnabledState(Boolean(settings?.sound_enabled));
    seededRef.current = true;
  }, [settings]);

  useEffect(() => {
    setApiKeyInput(getApiKey() ?? "");
  }, []);

  const handleApiKeySave = () => {
    setApiKey(apiKeyInput);
    // Keep the inline "Saved" pill on the button itself for fast
    // visual feedback at the click target, but ALSO surface a toast
    // so the user notices even if their gaze has moved away from
    // the field — same pattern as every other "saved" feedback.
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 1500);
    notifySyncInfo({
      op: "api-key-save",
      tone: "success",
      icon: "鍵",
      title: t("settings.keySaved"),
      body: t("common.apiKeySavedBody"),
    });
  };
  const handleApiKeyClear = () => {
    setApiKey("");
    setApiKeyInput("");
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 1500);
    notifySyncInfo({
      op: "api-key-clear",
      tone: "neutral",
      icon: "鍵",
      title: t("settings.keySaved"),
      body: t("common.apiKeyClearedBody"),
    });
  };

  const save = async (next) => {
    try {
      await updateSettings.mutateAsync(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      // 印 · Surface every accepted preference change as a toast.
      // The header chip stays as a quick "synced" confirmation, but
      // the toast is the canonical channel — matches refresh-upcoming
      // and every other mutation feedback.
      notifySyncInfo({
        op: "settings-save",
        tone: "success",
        icon: "印",
        title: t("common.settingsSavedTitle"),
        body: t("common.settingsSavedBody"),
      });
    } catch (err) {
      console.error("Error updating setting:", err);
      notifySyncError(err, "settings-save");
    }
  };

  const baseSettings = () => ({
    adult_content_level: showAdultContent,
    currency: currencyObject,
    titleType,
    theme,
    language,
    sound_enabled: soundEnabled,
  });

  const handleAdultChange = (value) => {
    setShowAdultContent(value);
    save({ ...baseSettings(), adult_content_level: value });
  };
  const handleTitleChange = (value) => {
    setTitleType(value);
    save({ ...baseSettings(), titleType: value });
  };
  const handleThemeChange = (value) => {
    setTheme(value);
    save({ ...baseSettings(), theme: value });
  };
  const handleLanguageChange = (value) => {
    setLanguage(value);
    save({ ...baseSettings(), language: value });
  };
  const handleSoundChange = (value) => {
    setSoundEnabledState(value);
    // Update the local mirror right away so the success-toast sound
    // (fired by SyncToaster after `save()` resolves) plays through on
    // the toggle-on path. On toggle-off the mirror is already false by
    // the time the toast lands → silent, which is the right behaviour.
    setSoundEnabled(value);
    save({ ...baseSettings(), sound_enabled: value });
  };
  const handleCurrencyChange = (code) => {
    const nextCurrency = CURRENCY_FORMATS[code] ?? { code };
    setCurrencyObject(nextCurrency);
    save({ ...baseSettings(), currency: nextCurrency });
  };

  const handleRestore = async () => {
    setRestoring(true);
    setRestoreError(null);
    try {
      await forceResyncFromServer();
      setRestoreDone(true);
      // Modal stays open just long enough to play the success state
      // (the inline 復 stamp transition), then closes and lets the
      // toast carry the confirmation forward.
      setTimeout(() => {
        setConfirmRestore(false);
        setRestoreDone(false);
      }, 1200);
      notifySyncInfo({
        op: "settings-restore",
        tone: "success",
        icon: "復",
        title: t("common.restoreDoneTitle"),
        body: t("common.restoreDoneBody"),
      });
    } catch (err) {
      console.error(err);
      // Keep the inline error inside the modal — this is the right
      // place for it: it explains what failed while the user is still
      // looking at the Restore button. Also emit the toast so the
      // user sees something even if they close the modal in panic.
      const message =
        err?.response?.data?.error ??
        err?.message ??
        t("settings.restoreFailedGeneric");
      setRestoreError(message);
      notifySyncError(message, "settings-restore");
    } finally {
      setRestoring(false);
    }
  };

  // Scroll-spy wiring. Watches each chapter section and elects the topmost
  // one whose body sits in the upper-half of the viewport as "active".
  useChapterSpy({
    ids: CHAPTERS.map((c) => c.id),
    onActive: (id) => {
      setActiveChapter(id);
      // Mirror to URL so the user can copy the link mid-scroll.
      if (typeof window !== "undefined" && window.history?.replaceState) {
        const currentHash = window.location.hash.slice(1);
        if (currentHash !== id) {
          window.history.replaceState(null, "", `#${id}`);
        }
      }
    },
    enabled: !settingsLoading,
  });

  return (
    <div className="relative mx-auto max-w-3xl px-4 pt-6 pb-nav md:pb-16 sm:px-6 md:pt-10 lg:max-w-4xl lg:pr-24">
      <Header saved={saved} t={t} />

      {/* 目次 · Mobile index ribbon — kanji-only, hairline separators,
          deliberately styled NOT as tabs but as a chapter marker strip
          like the running header of a printed manga volume. */}
      <KanjiRibbon
        chapters={CHAPTERS}
        active={activeChapter}
        onJump={goToChapter}
        t={t}
      />

      {settingsLoading ? (
        <SettingsSkeleton />
      ) : (
        <main className="space-y-12 md:space-y-16">
          <Chapter
            id="appearance"
            chapter={CHAPTERS[0]}
            title={t("settings.tabAppearance")}
            subtitle={t("settings.tabAppearanceHint")}
            t={t}
          >
            <ThemeSection
              options={THEME_OPTIONS}
              value={theme}
              onChange={handleThemeChange}
              t={t}
            />
            <SeasonSection />
            <AtmosphereSection />
            <HapticsSection
              enabled={hapticsOn}
              onToggle={handleHapticsToggle}
              t={t}
            />
            <SoundSection
              enabled={soundEnabled}
              onToggle={handleSoundChange}
              t={t}
            />
          </Chapter>

          <Chapter
            id="content"
            chapter={CHAPTERS[1]}
            title={t("settings.tabContent")}
            subtitle={t("settings.tabContentHint")}
            t={t}
          >
            <LanguageSection
              value={language}
              onChange={handleLanguageChange}
              t={t}
            />
            <TitleLanguageSection
              options={TITLE_OPTIONS}
              value={titleType}
              onChange={handleTitleChange}
              t={t}
            />
            <CurrencySection
              currency={currencyObject}
              onChange={handleCurrencyChange}
              t={t}
            />
            <AdultContentSection
              options={ADULT_OPTIONS}
              value={showAdultContent}
              onChange={handleAdultChange}
              t={t}
            />
            <ScannerKeySection
              apiKey={apiKeyInput}
              setApiKey={setApiKeyInput}
              revealed={apiKeyRevealed}
              setRevealed={setApiKeyRevealed}
              saved={apiKeySaved}
              onSave={handleApiKeySave}
              onClear={handleApiKeyClear}
              t={t}
            />
          </Chapter>

          <Chapter
            id="account"
            chapter={CHAPTERS[2]}
            title={t("settings.tabAccount")}
            subtitle={t("settings.tabAccountHint")}
            t={t}
          >
            <PublicProfileSection />
            <BirthdayModeSection />
            <ArchiveSection />
            <ShelfStickersEntry t={t} />
            <OnboardingSection />
          </Chapter>

          <Chapter
            id="advanced"
            chapter={CHAPTERS[3]}
            title={t("settings.tabAdvanced")}
            subtitle={t("settings.tabAdvancedHint")}
            t={t}
          >
            <DataSection
              online={online}
              pending={pending}
              onRestoreClick={() => setConfirmRestore(true)}
              onDeleteClick={() => setDeleteFlowOpen(true)}
              t={t}
            />
          </Chapter>
        </main>
      )}

      {/* 索引 · Desktop floating index rail — only on lg+ where there's
          horizontal real estate to spare. Behaves like the lateral
          bookmark of a bound volume. */}
      <KanjiRail
        chapters={CHAPTERS}
        active={activeChapter}
        onJump={goToChapter}
        t={t}
      />

      <RestoreModal
        open={confirmRestore}
        pending={pending}
        restoring={restoring}
        restoreError={restoreError}
        restoreDone={restoreDone}
        onClose={() => setConfirmRestore(false)}
        onConfirm={handleRestore}
        t={t}
      />

      {deleteFlowOpen && (
        <Suspense fallback={null}>
          <DeleteAccountFlow open onClose={() => setDeleteFlowOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}

// ─── Header ────────────────────────────────────────────────────────────────

function Header({ saved, t }) {
  return (
    <header className="mb-10 animate-fade-up md:mb-14">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim sm:text-xs">
          {t("settings.heading")}
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-4">
        <h1 className="font-display text-3xl font-light italic leading-none tracking-tight text-washi sm:text-4xl md:text-5xl">
          <span className="text-hanko-gradient font-semibold not-italic">
            {t("settings.preferences")}
          </span>
        </h1>
        <SavedBadge saved={saved} t={t} />
      </div>
    </header>
  );
}

function SavedBadge({ saved, t }) {
  return (
    <div
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-all sm:px-3 ${
        saved
          ? "border-gold/40 bg-gold/10 text-gold"
          : "border-border text-washi-dim"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full transition ${
          saved ? "bg-gold" : "bg-washi-dim"
        }`}
      />
      <span className="hidden sm:inline">
        {saved ? t("common.saved") : t("settings.synced")}
      </span>
      <span className="sm:hidden" aria-hidden="true">
        {saved ? "✓" : "·"}
      </span>
    </div>
  );
}

// ─── Chapter scaffolding ───────────────────────────────────────────────────

function Chapter({ id, chapter, title, subtitle, children, t }) {
  // `scroll-margin-top` clears the sticky mobile ribbon (~64px) + the
  // breathing room above the first card. Numbers are visual feel, not
  // pixel-precise — adjust together with the ribbon's own height.
  return (
    <section
      id={`ch-${id}`}
      aria-labelledby={`ch-${id}-title`}
      className="scroll-mt-28 md:scroll-mt-12"
    >
      <ChapterHeading
        chapter={chapter}
        title={title}
        subtitle={subtitle}
        idAttr={`ch-${id}-title`}
        t={t}
      />
      <div className="space-y-5 md:space-y-6">{children}</div>
    </section>
  );
}

function ChapterHeading({ chapter, title, subtitle, idAttr, t }) {
  return (
    <header className="mb-6 animate-fade-up md:mb-8">
      <div className="flex items-start gap-4 sm:gap-5">
        {/* 印 · Hanko-style chapter stamp. Stacked: ordinal on top
            (small), kanji on the bottom (large). Slight rotation +
            inset shadow give it a hand-pressed feel. */}
        <span
          className="chapter-stamp h-14 w-14 shrink-0 sm:h-16 sm:w-16"
          aria-hidden="true"
        >
          <span className="font-jp text-[9px] font-medium leading-none opacity-80 sm:text-[10px]">
            第{chapter.kanjiNum}章
          </span>
          <span className="mt-1 font-jp text-2xl font-bold leading-none sm:text-[28px]">
            {chapter.kanji}
          </span>
        </span>

        <div className="min-w-0 flex-1 pt-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-washi-dim">
            {t("settings.chapterLabel", { n: chapter.kanjiNum })}
          </p>
          <h2
            id={idAttr}
            className="mt-1 font-display text-2xl font-semibold italic leading-tight text-washi sm:text-3xl"
          >
            {title}
          </h2>
          <p className="mt-1 text-xs text-washi-muted sm:text-sm">{subtitle}</p>
        </div>
      </div>

      {/* Brushstroke divider — SVG path drawn left-to-right when the
          chapter scrolls into view. `viewBox=0 0 1200 8` gives an
          authentic taper at both ends. */}
      <svg
        viewBox="0 0 1200 8"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="mt-5 h-2 w-full"
      >
        <defs>
          <linearGradient id="brush-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--hanko)" stopOpacity="0" />
            <stop offset="14%" stopColor="var(--hanko)" stopOpacity="0.85" />
            <stop offset="50%" stopColor="var(--hanko-bright)" stopOpacity="1" />
            <stop offset="86%" stopColor="var(--hanko)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--hanko)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M2,4 Q200,1 400,4 T800,5 T1198,3"
          stroke="url(#brush-grad)"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          className="brushstroke-path"
        />
      </svg>
    </header>
  );
}

// ─── Index navigation ──────────────────────────────────────────────────────

// Mobile: sticky horizontal kanji ribbon. Designed to read like a chapter
// running-header, not a tab strip — kanji are large, separators are
// hairlines, the active state is a single hanko-red dot under the glyph.
function KanjiRibbon({ chapters, active, onJump, t }) {
  return (
    <nav
      aria-label={t("settings.indexAria")}
      className="sticky top-0 z-30 -mx-4 mb-10 border-y border-border/50 bg-ink-0/85 px-2 backdrop-blur-md sm:-mx-6 md:hidden"
    >
      <ol className="flex items-stretch justify-between divide-x divide-border/40">
        {chapters.map((c) => {
          const isActive = active === c.id;
          return (
            <li key={c.id} className="flex-1">
              <button
                onClick={() => onJump(c.id)}
                aria-current={isActive ? "true" : undefined}
                className={`group relative flex h-14 w-full flex-col items-center justify-center gap-0.5 transition ${
                  isActive ? "text-hanko-bright" : "text-washi-dim"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="font-mono text-[8px] uppercase tracking-[0.18em] opacity-70"
                >
                  第{c.kanjiNum}
                </span>
                <span
                  aria-hidden="true"
                  className={`font-jp font-bold leading-none transition-transform ${
                    isActive
                      ? "text-xl drop-shadow-[0_0_8px_var(--hanko-glow)]"
                      : "text-lg group-hover:scale-105"
                  }`}
                >
                  {c.kanji}
                </span>
                <span className="sr-only">{t(c.labelKey)}</span>
                {/* Active dot — a single hanko bullet under the glyph. */}
                <span
                  aria-hidden="true"
                  className={`absolute bottom-1 h-1 w-1 rounded-full transition-all ${
                    isActive
                      ? "scale-100 bg-hanko-bright shadow-[0_0_6px_var(--hanko-glow)]"
                      : "scale-0 bg-transparent"
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// Desktop: floating right-edge column. Sticky to vertical center, looks like
// a pendant scroll (掛軸 kakejiku) hanging next to the page.
function KanjiRail({ chapters, active, onJump, t }) {
  return (
    <aside
      aria-label={t("settings.indexAria")}
      className="pointer-events-none fixed right-3 top-1/2 z-30 hidden -translate-y-1/2 lg:block"
    >
      <div className="pointer-events-auto rounded-2xl border border-border/60 bg-ink-1/70 p-2 shadow-xl backdrop-blur-md">
        {/* Header glyph — frames the rail like the cap of a scroll. */}
        <p className="mb-1 text-center font-mono text-[8px] uppercase tracking-[0.22em] text-washi-dim">
          目次
        </p>
        <ol className="flex flex-col gap-0.5">
          {chapters.map((c) => {
            const isActive = active === c.id;
            return (
              <li key={c.id}>
                <button
                  onClick={() => onJump(c.id)}
                  aria-current={isActive ? "true" : undefined}
                  className={`group relative flex h-14 w-12 flex-col items-center justify-center rounded-md transition ${
                    isActive
                      ? "bg-hanko/15 text-hanko-bright"
                      : "text-washi-dim hover:bg-ink-2/40 hover:text-washi"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="font-jp text-[9px] leading-none opacity-70"
                  >
                    第{c.kanjiNum}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`mt-1 font-jp text-lg font-bold leading-none transition ${
                      isActive ? "drop-shadow-[0_0_6px_var(--hanko-glow)]" : ""
                    }`}
                  >
                    {c.kanji}
                  </span>
                  <span className="sr-only">{t(c.labelKey)}</span>

                  {/* Active marker — a vertical hanko slash on the
                      inner edge, like the corner of a stamp aligned
                      to the page binding. */}
                  <span
                    aria-hidden="true"
                    className={`absolute -left-1 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full bg-hanko-bright transition-all ${
                      isActive
                        ? "opacity-100 shadow-[0_0_8px_var(--hanko-glow)]"
                        : "opacity-0"
                    }`}
                  />

                  {/* Tooltip on hover, anchored to the LEFT of the rail
                      so it doesn't run off the viewport's right edge. */}
                  <span className="pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-ink-1 px-2.5 py-1 text-[11px] font-semibold text-washi opacity-0 shadow-lg transition group-hover:opacity-100">
                    {t(c.labelKey)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}

// Scroll-spy hook — IntersectionObserver tuned to fire when a chapter
// crosses the upper third of the viewport. Avoids the "topmost intersecting"
// jitter you get with naive ratio-based picking.
function useChapterSpy({ ids, onActive, enabled = true }) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const nodes = ids
      .map((id) => document.getElementById(`ch-${id}`))
      .filter(Boolean);
    if (!nodes.length) return;

    let activeId = null;
    const observer = new IntersectionObserver(
      (entries) => {
        // For each entry, track whether it's currently above its
        // anchor line. The "active" chapter is the LAST one that has
        // crossed the top — i.e. the one currently filling the viewport.
        entries.forEach((entry) => {
          const id = entry.target.id.replace(/^ch-/, "");
          if (entry.isIntersecting) {
            const next = id;
            if (next !== activeId) {
              activeId = next;
              onActive(next);
            }
          }
        });
      },
      {
        // Anchor line at 25% from the top of the viewport. Generous
        // bottom margin so a short chapter near the page bottom still
        // wins activation when scrolled to.
        rootMargin: "-25% 0px -55% 0px",
        threshold: 0,
      },
    );

    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [ids, onActive, enabled]);
}

// ─── Card primitives ───────────────────────────────────────────────────────

function Card({ children, danger = false }) {
  return (
    <section
      className={`rounded-2xl border p-4 backdrop-blur sm:p-6 ${
        danger
          ? "border-hanko/20 bg-gradient-to-br from-hanko/5 to-ink-1/50"
          : "border-border bg-ink-1/50"
      }`}
    >
      {children}
    </section>
  );
}

function CardHeader({ title, body, kanji, accent = "hanko" }) {
  const accentClasses = {
    hanko: "from-hanko-deep to-hanko shadow-[0_2px_10px_var(--hanko-glow)]",
    gold: "from-gold to-gold-muted shadow-[0_2px_10px_rgba(201,169,97,0.35)]",
    moegi: "from-moegi to-moegi-muted shadow-[0_2px_10px_rgba(163,201,97,0.35)]",
  };
  return (
    <div className="mb-4 flex items-start gap-3">
      {kanji && (
        <span
          aria-hidden="true"
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-md bg-gradient-to-br text-washi ${accentClasses[accent]}`}
          style={{ transform: "rotate(-4deg)" }}
        >
          <span className="font-jp text-sm font-bold leading-none">{kanji}</span>
        </span>
      )}
      <div className="min-w-0">
        <h3 className="font-display text-base font-semibold text-washi sm:text-lg">
          {title}
        </h3>
        {body && <p className="mt-1 text-xs text-washi-muted">{body}</p>}
      </div>
    </div>
  );
}

function RadioCard({ checked, onClick, name, value, children }) {
  return (
    <label
      className={`group relative cursor-pointer overflow-hidden rounded-xl border p-3 transition ${
        checked
          ? "border-hanko/60 bg-hanko/10"
          : "border-border bg-ink-0/40 hover:border-border/80"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onClick}
        className="sr-only"
      />
      {children}
      {checked && (
        <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-hanko text-washi">
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
        </span>
      )}
    </label>
  );
}

// ─── Sections — Apparence ──────────────────────────────────────────────────

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

// ─── Sections — Contenu ────────────────────────────────────────────────────

function LanguageSection({ value, onChange, t }) {
  return (
    <Card>
      <CardHeader
        title={t("settings.language")}
        body={t("settings.languageBody")}
      />
      <div className="grid gap-2 sm:grid-cols-3">
        {LANGUAGES.map((lang) => (
          <RadioCard
            key={lang.code}
            name="language"
            value={lang.code}
            checked={value === lang.code}
            onClick={() => onChange(lang.code)}
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">{lang.flag}</span>
              <div className="min-w-0 flex-1">
                <p
                  className={`font-display text-sm font-semibold ${
                    value === lang.code ? "text-hanko-bright" : "text-washi"
                  }`}
                >
                  {lang.label}
                </p>
                <p className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
                  {lang.code}
                </p>
              </div>
            </div>
          </RadioCard>
        ))}
      </div>
    </Card>
  );
}

function TitleLanguageSection({ options, value, onChange, t }) {
  return (
    <Card>
      <CardHeader
        title={t("settings.titleLanguage")}
        body={t("settings.titleBody")}
      />
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((opt) => (
          <RadioCard
            key={opt.value}
            name="title"
            value={opt.value}
            checked={value === opt.value}
            onClick={() => onChange(opt.value)}
          >
            <p
              className={`text-center font-display text-sm font-semibold ${
                value === opt.value ? "text-hanko-bright" : "text-washi"
              }`}
            >
              {opt.label}
            </p>
          </RadioCard>
        ))}
      </div>
    </Card>
  );
}

function CurrencySection({ currency, onChange, t }) {
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-base font-semibold text-washi sm:text-lg">
            {t("settings.currency")}
          </h3>
          <p className="mt-1 text-xs text-washi-muted">
            {t("settings.currencyBody")}
          </p>
        </div>
        <div className="shrink-0 rounded-lg border border-border bg-ink-0 px-3 py-2 text-right">
          <p className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
            {t("settings.currencyPreview")}
          </p>
          <p className="font-display text-base font-semibold text-gold">
            {formatCurrency(165.182, currency)}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {CURRENCIES.map((c) => (
          <button
            key={c.code}
            onClick={() => onChange(c.code)}
            className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
              currency?.code === c.code
                ? "border-hanko/60 bg-hanko/10"
                : "border-border bg-ink-0/40 hover:border-border/80"
            }`}
          >
            <span className="text-xl">{c.flag}</span>
            <div className="min-w-0 flex-1">
              <p
                className={`font-display text-sm font-semibold ${
                  currency?.code === c.code ? "text-hanko-bright" : "text-washi"
                }`}
              >
                {c.code}
              </p>
              <p className="text-[10px] text-washi-muted">
                {t(`settings.currency${c.key}`)}
              </p>
            </div>
            {currency?.code === c.code && (
              <span className="grid h-5 w-5 place-items-center rounded-full bg-hanko text-washi">
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
              </span>
            )}
          </button>
        ))}
      </div>
    </Card>
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

function AdultContentSection({ options, value, onChange, t }) {
  return (
    <Card>
      <CardHeader
        title={t("settings.adultContent")}
        body={t("settings.adultBody")}
      />
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((opt) => (
          <RadioCard
            key={opt.value}
            name="adult"
            value={opt.value}
            checked={value === opt.value}
            onClick={() => onChange(opt.value)}
          >
            <p
              className={`font-display text-sm font-semibold ${
                value === opt.value ? "text-hanko-bright" : "text-washi"
              }`}
            >
              {opt.label}
            </p>
            <p className="mt-1 text-[10px] leading-tight text-washi-muted">
              {opt.description}
            </p>
          </RadioCard>
        ))}
      </div>
    </Card>
  );
}

function ScannerKeySection({
  apiKey,
  setApiKey,
  revealed,
  setRevealed,
  saved,
  onSave,
  onClear,
  t,
}) {
  return (
    <Card>
      <CardHeader
        title={t("settings.barcodeScanner")}
        body={t("settings.scannerBody")}
      />
      <label
        htmlFor="google-books-key"
        className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim"
      >
        {t("settings.apiKeyLabel")}
      </label>
      <div className="flex items-center gap-2">
        <input
          id="google-books-key"
          type={revealed ? "text" : "password"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={t("settings.apiKeyPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          className="flex-1 rounded-lg border border-border bg-ink-0/60 px-3 py-2 font-mono text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
        />
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-label={revealed ? t("settings.hideKey") : t("settings.revealKey")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border text-washi-muted transition hover:text-washi"
        >
          {revealed ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <a
          href="https://console.cloud.google.com/apis/library/books.googleapis.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-washi-dim transition hover:text-washi"
        >
          {t("settings.getKey")}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
            <path d="M7 17 17 7M7 7h10v10" />
          </svg>
        </a>
        <div className="flex items-center gap-2">
          {apiKey && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-full border border-border bg-transparent px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi"
            >
              {t("common.clear")}
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={apiKey === (getApiKey() ?? "")}
            className="inline-flex items-center gap-1.5 rounded-full bg-hanko px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-washi transition hover:bg-hanko-bright active:scale-95 disabled:opacity-40"
          >
            {saved ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("settings.keySaved")}
              </>
            ) : (
              t("settings.saveKey")
            )}
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-gold/20 bg-gold/5 p-3 text-[11px] text-washi-muted">
        <p>{t("settings.apiKeyTip")}</p>
      </div>
    </Card>
  );
}

// ─── Sections — Compte / Données ───────────────────────────────────────────

function ShelfStickersEntry({ t }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-gradient-to-br from-hanko-deep to-hanko text-washi shadow-[0_2px_10px_var(--hanko-glow)]"
            style={{ transform: "rotate(-4deg)" }}
          >
            <span className="font-jp text-sm font-bold leading-none">札</span>
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold text-washi sm:text-lg">
              {t("shelfStickers.settingsTitle")}
            </h3>
            <p className="mt-1 text-xs text-washi-muted">
              {t("shelfStickers.settingsBody")}
            </p>
          </div>
        </div>
        <Link
          to="/settings/shelf-stickers"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hanko/40 bg-hanko/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-hanko-bright transition hover:border-hanko/70 hover:bg-hanko/20 active:scale-95"
        >
          {t("shelfStickers.settingsCta")}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </Card>
  );
}

function OnboardingSection() {
  const t = useT();
  const [open, setOpen] = useState(false);

  const replay = () => {
    // Wipe the "seen" flag so the dashboard auto-open path fires again next visit.
    resetTourSeen();
    setOpen(true);
  };

  return (
    <>
      <WelcomeTour open={open} onClose={() => setOpen(false)} />
      <Card>
        <CardHeader
          title={t("settings.onboardingSection")}
          body={t("settings.onboardingBody")}
          kanji="始"
          accent="hanko"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={replay}
            className="group inline-flex items-center gap-2 rounded-full border border-hanko/40 bg-hanko/10 px-4 py-2 text-sm font-semibold text-washi transition hover:border-hanko hover:bg-hanko/20"
          >
            <span
              aria-hidden="true"
              className="font-jp text-base font-bold leading-none text-hanko-bright transition-transform group-hover:scale-110"
            >
              始
            </span>
            {t("settings.replayTour")}
          </button>
          <a
            href="/glossary"
            className="group inline-flex items-center gap-2 rounded-full border border-border bg-ink-2/40 px-4 py-2 text-sm font-semibold text-washi-muted transition hover:border-hanko/40 hover:text-washi"
          >
            <span
              aria-hidden="true"
              className="font-jp text-base font-bold leading-none text-washi-dim transition-colors group-hover:text-hanko"
            >
              字典
            </span>
            {t("settings.openGlossary")}
          </a>
        </div>
      </Card>
    </>
  );
}

// ─── Section — Avancé ──────────────────────────────────────────────────────

function DataSection({ online, pending, onRestoreClick, onDeleteClick, t }) {
  return (
    <Card danger>
      <CardHeader
        title={t("settings.dataSection")}
        body={t("settings.dataBody")}
      />

      {/* Restore — reversible, hanko-tinted but lighter than the delete row. */}
      <div className="rounded-xl border border-border bg-ink-0/40 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-semibold text-washi">
              {t("settings.restoreFromServer")}
            </p>
            <p className="mt-1 text-xs text-washi-muted">
              {t("settings.restoreDesc")}
              {pending > 0 &&
                t(
                  pending === 1
                    ? "settings.pendingDiscardOne"
                    : "settings.pendingDiscardMany",
                  { n: pending },
                )}
            </p>
          </div>
          <button
            onClick={onRestoreClick}
            disabled={!online}
            title={online ? "" : t("settings.restoreConnectionHint")}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-hanko/40 bg-hanko/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-hanko-bright transition hover:bg-hanko/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
            {t("settings.restore")}
          </button>
        </div>
      </div>

      {/* Delete — irreversible. Darker frame, kanji 消, hanko gradient. */}
      <div className="relative mt-3 overflow-hidden rounded-xl border border-hanko/60 bg-gradient-to-br from-hanko/10 via-ink-0/60 to-ink-0/40 p-4">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-hanko/70 to-transparent"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-gradient-to-br from-hanko-bright to-hanko-deep text-washi shadow-[0_0_12px_var(--hanko-glow)]"
              style={{ transform: "rotate(-4deg)" }}
            >
              <span className="font-display text-sm font-bold leading-none">消</span>
            </span>
            <div className="min-w-0">
              <p className="font-display text-sm font-semibold text-washi">
                {t("settings.deleteAccountTitle")}
              </p>
              <p className="mt-1 text-xs text-washi-muted">
                {t("settings.deleteAccountDesc")}
              </p>
            </div>
          </div>
          <button
            onClick={onDeleteClick}
            disabled={!online}
            title={online ? "" : t("settings.restoreConnectionHint")}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-hanko bg-gradient-to-br from-hanko-deep to-hanko px-4 py-2 text-xs font-bold uppercase tracking-wider text-washi shadow-[0_4px_14px_var(--hanko-glow)] transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            {t("settings.deleteAccountCta")}
          </button>
        </div>
      </div>
    </Card>
  );
}

// ─── Restore confirmation modal ────────────────────────────────────────────

function RestoreModal({
  open,
  pending,
  restoring,
  restoreError,
  restoreDone,
  onClose,
  onConfirm,
  t,
}) {
  return (
    <Modal popupOpen={open} handleClose={restoring ? undefined : onClose}>
      <div className="max-w-md rounded-2xl border border-border bg-ink-1 p-6 shadow-2xl">
        <div className="hanko-seal mx-auto mb-4 grid h-12 w-12 place-items-center rounded-md font-display text-sm">
          復
        </div>
        <h3 className="text-center font-display text-xl font-semibold text-washi">
          {t("settings.restoreModalTitle")}
        </h3>
        <p className="mt-3 text-center text-sm text-washi-muted">
          {t("settings.restoreModalBody")}
        </p>

        {pending > 0 && (
          <div className="mt-4 rounded-lg border border-hanko/30 bg-hanko/10 p-3 text-xs text-washi">
            <p className="font-semibold text-hanko-bright">
              {t(
                pending === 1
                  ? "settings.pendingWarningOne"
                  : "settings.pendingWarningMany",
                { n: pending },
              )}
            </p>
            <p className="mt-1 text-washi-muted">
              {t("settings.pendingWarningDetail")}
            </p>
          </div>
        )}

        {restoreError && (
          <div className="mt-4 rounded-lg border border-hanko/30 bg-hanko/10 p-3 text-xs text-hanko-bright">
            {restoreError}
          </div>
        )}

        {restoreDone && (
          <div className="mt-4 rounded-lg border border-gold/30 bg-gold/10 p-3 text-xs text-gold">
            {t("settings.restoreDone")}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            disabled={restoring}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-washi-muted transition hover:text-washi disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={restoring || restoreDone}
            className="flex-1 rounded-lg bg-hanko px-4 py-2 text-sm font-semibold text-washi transition hover:bg-hanko-bright disabled:opacity-60"
          >
            {restoring ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-washi/30 border-t-washi" />
                {t("settings.restoringState")}
              </span>
            ) : restoreDone ? (
              t("common.done")
            ) : (
              t("settings.restoreConfirm")
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────────

function SettingsSkeleton() {
  return (
    <div className="space-y-12 animate-fade-up md:space-y-16">
      {[3, 4, 3, 1].map((cardCount, idx) => (
        <section key={idx}>
          <div className="mb-6 flex items-start gap-4 sm:gap-5">
            <Skeleton className="h-14 w-14 shrink-0 sm:h-16 sm:w-16" />
            <div className="flex-1 space-y-2 pt-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-3 w-64" />
            </div>
          </div>
          <Skeleton className="mb-6 h-2 w-full" />
          <div className="space-y-5">
            {Array.from({ length: cardCount }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border border-border bg-ink-1/50 p-4 sm:p-6"
              >
                <Skeleton className="h-5 w-32" />
                <Skeleton className="mt-2 h-3 w-64" />
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {[0, 1, 2].map((j) => (
                    <Skeleton key={j} className="h-16 w-full rounded-xl" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
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
