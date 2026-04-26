import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Modal from "@/components/ui/Modal.jsx";
import Skeleton from "@/components/ui/Skeleton.jsx";
// 削除 · The two-step GDPR erasure flow is a 550-line modal that
// only ever appears on a deliberate destructive action. Lazy-loading
// it keeps it off the wire on every Settings visit; the chunk fetch
// fires only the very first time the user clicks the danger button.
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
import { forceResyncFromServer, notifySyncError } from "@/lib/sync.js";
import { getApiKey, setApiKey } from "@/lib/isbn.js";
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

/**
 * Client-side mirror of the server's `get_currency_by_code`
 * (server/src/services/settings.rs). Needed because the backend
 * returns a rich object (`{ code, symbol, separator, decimal,
 * precision, format, negative_pattern }`) but the PATCH we send only
 * carries the selected code — and `formatCurrency` reads
 * `.symbol/.separator/...` to render the preview. Without this
 * hydration, every currency switch degrades to the `"$"` fallback
 * until the next server GET round-trips.
 *
 * Keep in sync with the server list. New currencies added on the
 * backend must also appear here (and in CURRENCIES above) until we
 * pull the full formatting info from the initial /api/user/settings
 * response.
 */
const CURRENCY_FORMATS = {
  USD: {
    code: "USD",
    symbol: "$",
    separator: ",",
    decimal: ".",
    precision: 2,
    format: "!#",
    negative_pattern: "-!#",
  },
  EUR: {
    code: "EUR",
    symbol: "€",
    separator: " ",
    decimal: ",",
    precision: 2,
    format: "#!",
    negative_pattern: "-#!",
  },
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
  const [saved, setSaved] = useState(false);

  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState(null);
  const [restoreDone, setRestoreDone] = useState(false);

  // GDPR account-deletion flow — a two-step ceremony living in its own
  // component. Opens at step 1 (manifest), escalates to step 2 (typed
  // confirmation), then closes when done.
  const [deleteFlowOpen, setDeleteFlowOpen] = useState(false);

  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyRevealed, setApiKeyRevealed] = useState(false);
  const [apiKeySaved, setApiKeySaved] = useState(false);

  // Seed local state from server ONCE, not on every settings refresh.
  // Without this guard, a background refetch (focus regain, realtime
  // sync) arriving while the user is clicking Currency/Language
  // buttons would reset their in-progress selection to whatever the
  // server last persisted — a visible flicker and sometimes a lost
  // edit. `seededRef` flips true the first time we have data; after
  // that, the server stops owning the UI and the user does.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!settings || seededRef.current) return;
    setShowAdultContent(settings?.adult_content_level || 0);
    setCurrencyObject(settings?.currency);
    setTitleType(settings?.titleType || "Default");
    setTheme(settings?.theme || "dark");
    setLanguage(settings?.language || "en");
    seededRef.current = true;
  }, [settings]);

  useEffect(() => {
    setApiKeyInput(getApiKey() ?? "");
  }, []);

  const handleApiKeySave = () => {
    setApiKey(apiKeyInput);
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 1500);
  };

  const handleApiKeyClear = () => {
    setApiKey("");
    setApiKeyInput("");
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 1500);
  };

  const save = async (next) => {
    try {
      await updateSettings.mutateAsync(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
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

  const handleCurrencyChange = (code) => {
    // Hydrate the full format object from the client-side lookup so
    // downstream `formatCurrency` reads see the correct symbol /
    // separator / decimal / precision / format IMMEDIATELY. The
    // previous `{ code }` alone triggered a "$"/USD fallback flicker
    // for every switch while waiting for the server response.
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
      setTimeout(() => {
        setConfirmRestore(false);
        setRestoreDone(false);
      }, 1200);
    } catch (err) {
      console.error(err);
      setRestoreError(
        err?.response?.data?.error ??
          err?.message ??
          t("settings.restoreFailedGeneric"),
      );
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
      <header className="mb-8 animate-fade-up">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs uppercase tracking-[0.3em] text-washi-dim">
            {t("settings.heading")}
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <h1 className="font-display text-4xl font-light italic leading-none tracking-tight text-washi md:text-5xl">
            <span className="text-hanko-gradient font-semibold not-italic">
              {t("settings.preferences")}
            </span>
          </h1>
          <div
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wider transition-all ${
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
            {saved ? t("common.saved") : t("settings.synced")}
          </div>
        </div>
      </header>

      {settingsLoading && <SettingsSkeleton />}

      <div className={`space-y-6 ${settingsLoading ? "hidden" : ""}`}>
        {/* ─── Theme ─── */}
        <section className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up">
          <div className="mb-4">
            <h2 className="font-display text-lg font-semibold text-washi">
              {t("settings.appearance")}
            </h2>
            <p className="mt-1 text-xs text-washi-muted">
              {t("settings.appearanceBody")}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {THEME_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`group relative cursor-pointer overflow-hidden rounded-xl border p-3 transition ${
                  theme === opt.value
                    ? "border-hanko/60 bg-hanko/10"
                    : "border-border bg-ink-0/40 hover:border-border/80"
                }`}
              >
                <input
                  type="radio"
                  name="theme"
                  value={opt.value}
                  checked={theme === opt.value}
                  onChange={() => handleThemeChange(opt.value)}
                  className="sr-only"
                />
                <div className="flex items-center gap-2.5">
                  <ThemeSwatch value={opt.value} />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`font-display text-sm font-semibold ${
                        theme === opt.value ? "text-hanko-bright" : "text-washi"
                      }`}
                    >
                      {opt.label}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-tight text-washi-muted">
                      {opt.description}
                    </p>
                  </div>
                </div>
                {theme === opt.value && (
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
            ))}
          </div>
        </section>

        {/* ─── Language ─── */}
        <section
          className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up"
          style={{ animationDelay: "50ms" }}
        >
          <div className="mb-4">
            <h2 className="font-display text-lg font-semibold text-washi">
              {t("settings.language")}
            </h2>
            <p className="mt-1 text-xs text-washi-muted">
              {t("settings.languageBody")}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {LANGUAGES.map((lang) => (
              <label
                key={lang.code}
                className={`group relative cursor-pointer overflow-hidden rounded-xl border p-3 transition ${
                  language === lang.code
                    ? "border-hanko/60 bg-hanko/10"
                    : "border-border bg-ink-0/40 hover:border-border/80"
                }`}
              >
                <input
                  type="radio"
                  name="language"
                  value={lang.code}
                  checked={language === lang.code}
                  onChange={() => handleLanguageChange(lang.code)}
                  className="sr-only"
                />
                <div className="flex items-center gap-3">
                  <span className="text-xl">{lang.flag}</span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`font-display text-sm font-semibold ${
                        language === lang.code
                          ? "text-hanko-bright"
                          : "text-washi"
                      }`}
                    >
                      {lang.label}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
                      {lang.code}
                    </p>
                  </div>
                </div>
                {language === lang.code && (
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
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up">
          <div className="mb-4">
            <h2 className="font-display text-lg font-semibold text-washi">
              {t("settings.adultContent")}
            </h2>
            <p className="mt-1 text-xs text-washi-muted">
              {t("settings.adultBody")}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {ADULT_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`group relative cursor-pointer overflow-hidden rounded-xl border p-3 transition ${
                  showAdultContent === opt.value
                    ? "border-hanko/60 bg-hanko/10"
                    : "border-border bg-ink-0/40 hover:border-border/80"
                }`}
              >
                <input
                  type="radio"
                  name="adult"
                  value={opt.value}
                  checked={showAdultContent === opt.value}
                  onChange={() => handleAdultChange(opt.value)}
                  className="sr-only"
                />
                <p
                  className={`font-display text-sm font-semibold ${
                    showAdultContent === opt.value
                      ? "text-hanko-bright"
                      : "text-washi"
                  }`}
                >
                  {opt.label}
                </p>
                <p className="mt-1 text-[10px] leading-tight text-washi-muted">
                  {opt.description}
                </p>
                {showAdultContent === opt.value && (
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
            ))}
          </div>
        </section>

        <section
          className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up"
          style={{ animationDelay: "100ms" }}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-washi">
                {t("settings.currency")}
              </h2>
              <p className="mt-1 text-xs text-washi-muted">
                {t("settings.currencyBody")}
              </p>
            </div>
            <div className="shrink-0 rounded-lg border border-border bg-ink-0 px-3 py-2 text-right">
              <p className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
                {t("settings.currencyPreview")}
              </p>
              <p className="font-display text-base font-semibold text-gold">
                {formatCurrency(165.182, currencyObject)}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {CURRENCIES.map((c) => (
              <button
                key={c.code}
                onClick={() => handleCurrencyChange(c.code)}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                  currencyObject?.code === c.code
                    ? "border-hanko/60 bg-hanko/10"
                    : "border-border bg-ink-0/40 hover:border-border/80"
                }`}
              >
                <span className="text-xl">{c.flag}</span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`font-display text-sm font-semibold ${
                      currencyObject?.code === c.code
                        ? "text-hanko-bright"
                        : "text-washi"
                    }`}
                  >
                    {c.code}
                  </p>
                  <p className="text-[10px] text-washi-muted">
                    {t(`settings.currency${c.key}`)}
                  </p>
                </div>
                {currencyObject?.code === c.code && (
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
        </section>

        <section
          className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up"
          style={{ animationDelay: "200ms" }}
        >
          <div className="mb-4">
            <h2 className="font-display text-lg font-semibold text-washi">
              {t("settings.titleLanguage")}
            </h2>
            <p className="mt-1 text-xs text-washi-muted">
              {t("settings.titleBody")}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {TITLE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`cursor-pointer rounded-xl border p-3 transition ${
                  titleType === opt.value
                    ? "border-hanko/60 bg-hanko/10"
                    : "border-border bg-ink-0/40 hover:border-border/80"
                }`}
              >
                <input
                  type="radio"
                  name="title"
                  value={opt.value}
                  checked={titleType === opt.value}
                  onChange={() => handleTitleChange(opt.value)}
                  className="sr-only"
                />
                <p
                  className={`text-center font-display text-sm font-semibold ${
                    titleType === opt.value ? "text-hanko-bright" : "text-washi"
                  }`}
                >
                  {opt.label}
                </p>
              </label>
            ))}
          </div>
        </section>

        {/* ─── Scanner / Google Books API key ─── */}
        <section
          className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up"
          style={{ animationDelay: "250ms" }}
        >
          <div className="mb-4">
            <h2 className="font-display text-lg font-semibold text-washi">
              {t("settings.barcodeScanner")}
            </h2>
            <p className="mt-1 text-xs text-washi-muted">
              {t("settings.scannerBody")}
            </p>
          </div>

          <div>
            <label
              htmlFor="google-books-key"
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim"
            >
              {t("settings.apiKeyLabel")}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="google-books-key"
                type={apiKeyRevealed ? "text" : "password"}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={t("settings.apiKeyPlaceholder")}
                autoComplete="off"
                spellCheck={false}
                className="flex-1 rounded-lg border border-border bg-ink-0/60 px-3 py-2 font-mono text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
              />
              <button
                type="button"
                onClick={() => setApiKeyRevealed((v) => !v)}
                aria-label={
                  apiKeyRevealed
                    ? t("settings.hideKey")
                    : t("settings.revealKey")
                }
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border text-washi-muted transition hover:text-washi"
              >
                {apiKeyRevealed ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4"
                  >
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4"
                  >
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
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3 w-3"
                >
                  <path d="M7 17 17 7M7 7h10v10" />
                </svg>
              </a>
              <div className="flex items-center gap-2">
                {apiKeyInput && (
                  <button
                    type="button"
                    onClick={handleApiKeyClear}
                    className="rounded-full border border-border bg-transparent px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi"
                  >
                    {t("common.clear")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleApiKeySave}
                  disabled={apiKeyInput === (getApiKey() ?? "")}
                  className="inline-flex items-center gap-1.5 rounded-full bg-hanko px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-washi transition hover:bg-hanko-bright active:scale-95 disabled:opacity-40"
                >
                  {apiKeySaved ? (
                    <>
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
          </div>
        </section>

        {/* ─── Seasonal theme — ambient glows shift with the Japanese
            season. Purely aesthetic, near the other look-and-feel
            settings. */}
        <SeasonSection />

        {/* ─── 風 Seasonal atmosphere — opt-out toggle for the drifting
            particle layer. Sits right after the season-palette picker
            because it's the same visual surface, just a different knob:
            "what palette" vs "do I want particles drifting through it". */}
        <AtmosphereSection />

        {/* ─── Onboarding · re-trigger the welcome tour on demand.
            The tour auto-shows on the first visit to an empty library;
            this section lets a returning user replay it (e.g. after
            recommending the app to a friend, or to remind themselves
            what the kanji ladder means). */}
        <OnboardingSection />

        {/* ─── Public profile section — toggle + slug editor.
            Sits before the Data/danger section so users see the feature
            in a natural progression: Account → Preferences → Sharing →
            Data management. */}
        <PublicProfileSection />

        {/* ─── 祝 Birthday mode — temporary wishlist exposure.
            Adjacent to the public-profile toggle because they're the
            same conceptual surface (what visitors see at /u/{slug}).
            The section is gated visually when the public profile is
            disabled — there's nowhere for the wishlist to live without
            a slug. */}
        <BirthdayModeSection />

        {/* ─── Archive (export / import) — sits alongside public
            profile as another "what can I do with my data" feature. */}
        <ArchiveSection />

        {/* ─── Data section ─── */}
        <section
          className="rounded-2xl border border-hanko/20 bg-gradient-to-br from-hanko/5 to-ink-1/50 p-6 backdrop-blur animate-fade-up"
          style={{ animationDelay: "300ms" }}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-hanko/20 text-hanko-bright">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3 w-3"
                  >
                    <path d="M12 9v4" />
                    <path d="M12 17h.01" />
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                  </svg>
                </span>
                <h2 className="font-display text-lg font-semibold text-washi">
                  {t("settings.dataSection")}
                </h2>
              </div>
              <p className="mt-1 text-xs text-washi-muted">
                {t("settings.dataBody")}
              </p>
            </div>
          </div>

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
                onClick={() => setConfirmRestore(true)}
                disabled={!online}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-hanko/40 bg-hanko/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-hanko-bright transition hover:bg-hanko/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                title={online ? "" : t("settings.restoreConnectionHint")}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <path d="M21 2v6h-6" />
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                  <path d="M3 22v-6h6" />
                  <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                </svg>
                {t("settings.restore")}
              </button>
            </div>
          </div>

          {/* GDPR erasure — more dangerous than Restore (wipes the server
              too), visually separated with a darker frame and the 消
              kanji marker so the weight is obvious. */}
          <div className="relative mt-4 overflow-hidden rounded-xl border border-hanko/60 bg-gradient-to-br from-hanko/10 via-ink-0/60 to-ink-0/40 p-4">
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
                  <span className="font-display text-sm font-bold leading-none">
                    消
                  </span>
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
                onClick={() => setDeleteFlowOpen(true)}
                disabled={!online}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-hanko bg-gradient-to-br from-hanko-deep to-hanko px-4 py-2 text-xs font-bold uppercase tracking-wider text-washi shadow-[0_4px_14px_var(--hanko-glow)] transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                title={online ? "" : t("settings.restoreConnectionHint")}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
                {t("settings.deleteAccountCta")}
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* ─── Confirmation modal ─── */}
      <Modal
        popupOpen={confirmRestore}
        handleClose={restoring ? undefined : () => setConfirmRestore(false)}
      >
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
              onClick={() => setConfirmRestore(false)}
              disabled={restoring}
              className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-washi-muted transition hover:text-washi disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleRestore}
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

      {/* Two-step GDPR erasure flow — lives in its own component
          because the ceremony is substantial enough to avoid
          bloating this page. Outer guard keeps the lazy chunk off
          the wire until the user actually opens the danger flow. */}
      {deleteFlowOpen && (
        <Suspense fallback={null}>
          <DeleteAccountFlow open onClose={() => setDeleteFlowOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}

/** Skeleton placeholder while settings stream in from Dexie + server. */
function SettingsSkeleton() {
  return (
    <div className="space-y-6 animate-fade-up">
      {[3, 3, 2, 3, 0, 0].map((cols, sectionIdx) => (
        <section
          key={sectionIdx}
          className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur"
        >
          <div className="mb-4 space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-64" />
          </div>
          {cols > 0 ? (
            <div
              className={`grid gap-2 ${
                cols === 2 ? "grid-cols-2" : "sm:grid-cols-3"
              }`}
            >
              {Array.from({ length: cols }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border p-3">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="mt-2 h-3 w-32" />
                </div>
              ))}
            </div>
          ) : (
            <Skeleton className="h-10 w-full" />
          )}
        </section>
      ))}
    </div>
  );
}

/** Tiny visual preview of each theme option — two tones + a hanko dot. */
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

/**
 * 始 · Onboarding section — replay-the-welcome-tour entry.
 * Stored as its own sub-component so the tour state lives close to the
 * button that triggers it; SettingsPage already has plenty of state of
 * its own. Re-rendered through the shared `<WelcomeTour>` modal so the
 * replay behaves identically to the auto-open path on the dashboard.
 */
function OnboardingSection() {
  const t = useT();
  const [open, setOpen] = useState(false);

  const replay = () => {
    // Wipe the seen flag so the auto-open path on the dashboard would
    // also fire on the next visit. The user explicitly asked to revisit
    // the tour, so it's reasonable that they may want it elsewhere too.
    resetTourSeen();
    setOpen(true);
  };

  return (
    <>
      <WelcomeTour open={open} onClose={() => setOpen(false)} />

      <section
        className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up"
        style={{ animationDelay: "260ms" }}
      >
        <div className="mb-4">
          <h2 className="font-display text-lg font-semibold text-washi">
            {t("settings.onboardingSection")}
          </h2>
          <p className="mt-1 text-xs text-washi-muted">
            {t("settings.onboardingBody")}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
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

          {/* 字典 · Quiet outline link to the public kanji glossary —
              same visual weight as a secondary action so it doesn't
              compete with the replay CTA but stays a step away. */}
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
      </section>
    </>
  );
}
