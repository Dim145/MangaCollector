import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import Modal from "@/components/ui/Modal.jsx";
import Skeleton from "@/components/ui/Skeleton.jsx";
// 削除 · GDPR erasure flow lives behind a lazy chunk so its 550 lines never
// touch the wire on a regular Settings visit.
const DeleteAccountFlow = lazy(() =>
  import("@/components/DeleteAccountFlow.jsx"),
);
import ChapterAppearance from "@/components/settings/ChapterAppearance.jsx";
import ChapterContent from "@/components/settings/ChapterContent.jsx";
import ChapterAccount from "@/components/settings/ChapterAccount.jsx";
import ChapterAdvanced from "@/components/settings/ChapterAdvanced.jsx";
import { useOnline } from "@/hooks/useOnline.js";
import { usePendingCount } from "@/hooks/usePendingCount.js";
import { useUpdateSettings, useUserSettings } from "@/hooks/useSettings.js";
import { forceResyncFromServer, notifySyncError, notifySyncInfo } from "@/lib/sync.js";
import { getApiKey, setApiKey } from "@/lib/isbn.js";
import { getHapticsEnabled, haptics, setHapticsEnabled } from "@/lib/haptics.js";
import { setSoundEnabled } from "@/lib/sounds.js";
import { DEFAULT_ACCENT } from "@/lib/accent.js";
import { useT } from "@/i18n/index.jsx";

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

// 組 · Sub-blocks group cards by topical affinity within a chapter.
// Each entry pairs a kanji glyph (the visual marker) with its label
// translation key. The sub-block stamp gets a smaller treatment than
// the chapter stamp — it sits between cards rather than above them, so
// the eye can quickly scan "all the visual stuff" / "all the language
// stuff" without misreading them as separate chapters.
const SUB_BLOCKS = {
  visual:     { kanji: "視", labelKey: "settings.subVisual" },
  atmosphere: { kanji: "雰", labelKey: "settings.subAtmosphere" },
  feedback:   { kanji: "響", labelKey: "settings.subFeedback" },
  language:   { kanji: "言", labelKey: "settings.subLanguage" },
  display:    { kanji: "表", labelKey: "settings.subDisplay" },
  publicShare:{ kanji: "公", labelKey: "settings.subPublic" },
  tools:      { kanji: "具", labelKey: "settings.subTools" },
  help:       { kanji: "助", labelKey: "settings.subHelp" },
};

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
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
  const [shelf3d, setShelf3d] = useState(false);
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
    setAccentColor(settings?.accent_color || DEFAULT_ACCENT);
    setShelf3d(Boolean(settings?.shelf_3d_enabled));
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
    // Server treats `""` as "reset to default" (NULL in DB) and any
    // unrecognised name as a no-op. The default-shu name maps to
    // `null` server-side via the empty-string convention.
    accent_color: accentColor === DEFAULT_ACCENT ? "" : accentColor,
    shelf_3d_enabled: shelf3d,
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
  const handleAccentChange = (name) => {
    setAccentColor(name);
    save({
      ...baseSettings(),
      accent_color: name === DEFAULT_ACCENT ? "" : name,
    });
  };
  const handleShelf3dChange = (value) => {
    setShelf3d(value);
    save({ ...baseSettings(), shelf_3d_enabled: value });
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
          <ChapterAppearance
            chapter={CHAPTERS[0]}
            subBlocks={SUB_BLOCKS}
            t={t}
            themeOptions={THEME_OPTIONS}
            theme={theme}
            onThemeChange={handleThemeChange}
            accentColor={accentColor}
            onAccentChange={handleAccentChange}
            shelf3d={shelf3d}
            onShelf3dChange={handleShelf3dChange}
            soundEnabled={soundEnabled}
            onSoundChange={handleSoundChange}
            hapticsOn={hapticsOn}
            onHapticsToggle={handleHapticsToggle}
          />

          <ChapterContent
            chapter={CHAPTERS[1]}
            subBlocks={SUB_BLOCKS}
            t={t}
            language={language}
            onLanguageChange={handleLanguageChange}
            titleOptions={TITLE_OPTIONS}
            titleType={titleType}
            onTitleChange={handleTitleChange}
            currencyObject={currencyObject}
            onCurrencyChange={handleCurrencyChange}
            adultOptions={ADULT_OPTIONS}
            showAdultContent={showAdultContent}
            onAdultChange={handleAdultChange}
          />

          <ChapterAccount
            chapter={CHAPTERS[2]}
            subBlocks={SUB_BLOCKS}
            t={t}
            apiKeyInput={apiKeyInput}
            setApiKeyInput={setApiKeyInput}
            apiKeyRevealed={apiKeyRevealed}
            setApiKeyRevealed={setApiKeyRevealed}
            apiKeySaved={apiKeySaved}
            onApiKeySave={handleApiKeySave}
            onApiKeyClear={handleApiKeyClear}
          />

          <ChapterAdvanced
            chapter={CHAPTERS[3]}
            t={t}
            online={online}
            pending={pending}
            onRestoreClick={() => setConfirmRestore(true)}
            onDeleteClick={() => setDeleteFlowOpen(true)}
          />
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
