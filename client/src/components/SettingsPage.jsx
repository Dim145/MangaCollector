import { useEffect, useState } from "react";
import Modal from "@/components/utils/Modal.jsx";
import Skeleton from "@/components/ui/Skeleton.jsx";
import { useOnline } from "@/hooks/useOnline.js";
import { usePendingCount } from "@/hooks/usePendingCount.js";
import { useUpdateSettings, useUserSettings } from "@/hooks/useSettings.js";
import { forceResyncFromServer } from "@/lib/sync.js";
import { getApiKey, setApiKey } from "@/lib/isbn.js";
import { formatCurrency } from "@/utils/price.js";

const ADULT_OPTIONS = [
  {
    value: 0,
    label: "Blur",
    description: "Cover art is blurred, volumes stay visible",
  },
  {
    value: 1,
    label: "Hide",
    description: "Adult titles are fully excluded from view",
  },
  { value: 2, label: "Show", description: "Display everything as-is" },
];

const TITLE_OPTIONS = [
  { value: "Default", label: "Default (MAL)" },
  { value: "English", label: "English" },
  { value: "Japanese", label: "Japanese" },
];

const THEME_OPTIONS = [
  { value: "dark", label: "Dark", description: "Ink & hanko red" },
  { value: "light", label: "Light", description: "Washi paper" },
  { value: "auto", label: "Auto", description: "Follows your system" },
];

const CURRENCIES = [
  { code: "USD", label: "US Dollar", flag: "🇺🇸" },
  { code: "EUR", label: "Euro", flag: "🇪🇺" },
];

export default function SettingsPage() {
  const { data: settings, isInitialLoad: settingsLoading } = useUserSettings();
  const updateSettings = useUpdateSettings();
  const online = useOnline();
  const pending = usePendingCount();

  const [showAdultContent, setShowAdultContent] = useState(0);
  const [currencyObject, setCurrencyObject] = useState(null);
  const [titleType, setTitleType] = useState("Default");
  const [theme, setTheme] = useState("dark");
  const [saved, setSaved] = useState(false);

  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState(null);
  const [restoreDone, setRestoreDone] = useState(false);

  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyRevealed, setApiKeyRevealed] = useState(false);
  const [apiKeySaved, setApiKeySaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setShowAdultContent(settings?.adult_content_level || 0);
    setCurrencyObject(settings?.currency);
    setTitleType(settings?.titleType || "Default");
    setTheme(settings?.theme || "dark");
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
    }
  };

  const handleAdultChange = (value) => {
    setShowAdultContent(value);
    save({
      adult_content_level: value,
      currency: currencyObject,
      titleType,
      theme,
    });
  };

  const handleTitleChange = (value) => {
    setTitleType(value);
    save({
      adult_content_level: showAdultContent,
      currency: currencyObject,
      titleType: value,
      theme,
    });
  };

  const handleThemeChange = (value) => {
    setTheme(value);
    save({
      adult_content_level: showAdultContent,
      currency: currencyObject,
      titleType,
      theme: value,
    });
  };

  const handleCurrencyChange = (code) => {
    const nextCurrency = { code };
    setCurrencyObject(nextCurrency);
    save({
      adult_content_level: showAdultContent,
      currency: nextCurrency,
      titleType,
      theme,
    });
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
          "Restore failed — please try again."
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
            SETTINGS · 設定
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <h1 className="font-display text-4xl font-light italic leading-none tracking-tight text-washi md:text-5xl">
            <span className="text-hanko-gradient font-semibold not-italic">
              Preferences
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
            {saved ? "Saved" : "Synced"}
          </div>
        </div>
      </header>

      {settingsLoading && <SettingsSkeleton />}

      <div className={`space-y-6 ${settingsLoading ? "hidden" : ""}`}>
        {/* ─── Theme ─── */}
        <section className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up">
          <div className="mb-4">
            <h2 className="font-display text-lg font-semibold text-washi">
              Appearance
            </h2>
            <p className="mt-1 text-xs text-washi-muted">
              Dark ink or washi paper. Auto follows your operating system.
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
                        theme === opt.value
                          ? "text-hanko-bright"
                          : "text-washi"
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

        <section className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up">
          <div className="mb-4">
            <h2 className="font-display text-lg font-semibold text-washi">
              Adult content
            </h2>
            <p className="mt-1 text-xs text-washi-muted">
              How mature titles appear throughout your archive.
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

        <section className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up" style={{ animationDelay: "100ms" }}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-washi">
                Currency
              </h2>
              <p className="mt-1 text-xs text-washi-muted">
                How prices are displayed across volumes and summaries.
              </p>
            </div>
            <div className="shrink-0 rounded-lg border border-border bg-ink-0 px-3 py-2 text-right">
              <p className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
                Preview
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
                  <p className="text-[10px] text-washi-muted">{c.label}</p>
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

        <section className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up" style={{ animationDelay: "200ms" }}>
          <div className="mb-4">
            <h2 className="font-display text-lg font-semibold text-washi">
              Title language
            </h2>
            <p className="mt-1 text-xs text-washi-muted">
              Which title is preferred when MAL provides alternatives.
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
              Barcode scanner
            </h2>
            <p className="mt-1 text-xs text-washi-muted">
              Scanning looks up each ISBN on Google Books. An optional API key
              lifts the anonymous per-IP rate limit — without it, scanning
              several volumes in a row can hit a 429.
            </p>
          </div>

          <div>
            <label
              htmlFor="google-books-key"
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim"
            >
              Google Books API key
            </label>
            <div className="flex items-center gap-2">
              <input
                id="google-books-key"
                type={apiKeyRevealed ? "text" : "password"}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="AIzaSy…"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 rounded-lg border border-border bg-ink-0/60 px-3 py-2 font-mono text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
              />
              <button
                type="button"
                onClick={() => setApiKeyRevealed((v) => !v)}
                aria-label={apiKeyRevealed ? "Hide key" : "Reveal key"}
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
                Get a key
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
                    Clear
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
                      Saved
                    </>
                  ) : (
                    "Save key"
                  )}
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-gold/20 bg-gold/5 p-3 text-[11px] text-washi-muted">
              <p>
                <span className="font-semibold text-gold">Tip:</span> restrict
                the key to your HTTP referrer in Google Cloud Console — it'll
                be rejected if leaked and used on another domain. The key is
                stored in your browser only (localStorage), never on the server.
              </p>
            </div>
          </div>
        </section>

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
                  Data
                </h2>
              </div>
              <p className="mt-1 text-xs text-washi-muted">
                Offline archive cached on this device. Pull fresh state from the
                server when you want to start clean.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-ink-0/40 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-semibold text-washi">
                  Restore from server
                </p>
                <p className="mt-1 text-xs text-washi-muted">
                  Replace the local archive with the latest server state.
                  {pending > 0 && (
                    <>
                      {" "}
                      <span className="font-semibold text-hanko-bright">
                        {pending} pending change{pending > 1 ? "s" : ""}
                      </span>{" "}
                      will be discarded.
                    </>
                  )}
                </p>
              </div>
              <button
                onClick={() => setConfirmRestore(true)}
                disabled={!online}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-hanko/40 bg-hanko/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-hanko-bright transition hover:bg-hanko/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                title={online ? "" : "Requires a connection"}
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
                Restore
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* ─── Confirmation modal ─── */}
      <Modal
        popupOpen={confirmRestore}
        handleClose={
          restoring ? undefined : () => setConfirmRestore(false)
        }
      >
        <div className="max-w-md rounded-2xl border border-border bg-ink-1 p-6 shadow-2xl">
          <div className="hanko-seal mx-auto mb-4 grid h-12 w-12 place-items-center rounded-md font-display text-sm">
            復
          </div>
          <h3 className="text-center font-display text-xl font-semibold text-washi">
            Restore from server?
          </h3>

          <p className="mt-3 text-center text-sm text-washi-muted">
            Your local archive — library, volumes, settings — will be
            <strong className="text-washi"> replaced </strong>
            with a fresh copy from the server.
          </p>

          {pending > 0 && (
            <div className="mt-4 rounded-lg border border-hanko/30 bg-hanko/10 p-3 text-xs text-washi">
              <p className="font-semibold text-hanko-bright">
                {pending} pending change{pending > 1 ? "s" : ""} will be discarded
              </p>
              <p className="mt-1 text-washi-muted">
                Edits queued offline that haven't synced yet will be permanently
                lost.
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
              Archive restored successfully.
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button
              onClick={() => setConfirmRestore(false)}
              disabled={restoring}
              className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-washi-muted transition hover:text-washi disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleRestore}
              disabled={restoring || restoreDone}
              className="flex-1 rounded-lg bg-hanko px-4 py-2 text-sm font-semibold text-washi transition hover:bg-hanko-bright disabled:opacity-60"
            >
              {restoring ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-washi/30 border-t-washi" />
                  Restoring…
                </span>
              ) : restoreDone ? (
                "Done"
              ) : (
                "Yes, restore"
              )}
            </button>
          </div>
        </div>
      </Modal>
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
                <div
                  key={i}
                  className="rounded-xl border border-border p-3"
                >
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
  const text = value === "dark" ? "oklch(0.96 0.012 85)" : "oklch(0.2 0.012 40)";

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
