import { useEffect, useState } from "react";
import Modal from "@/components/utils/Modal.jsx";
import { useOnline } from "@/hooks/useOnline.js";
import { usePendingCount } from "@/hooks/usePendingCount.js";
import { useUpdateSettings, useUserSettings } from "@/hooks/useSettings.js";
import { forceResyncFromServer } from "@/lib/sync.js";
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

const CURRENCIES = [
  { code: "USD", label: "US Dollar", flag: "🇺🇸" },
  { code: "EUR", label: "Euro", flag: "🇪🇺" },
];

export default function SettingsPage() {
  const { data: settings } = useUserSettings();
  const updateSettings = useUpdateSettings();
  const online = useOnline();
  const pending = usePendingCount();

  const [showAdultContent, setShowAdultContent] = useState(0);
  const [currencyObject, setCurrencyObject] = useState(null);
  const [titleType, setTitleType] = useState("Default");
  const [saved, setSaved] = useState(false);

  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState(null);
  const [restoreDone, setRestoreDone] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setShowAdultContent(settings?.adult_content_level || 0);
    setCurrencyObject(settings?.currency);
    setTitleType(settings?.titleType || "Default");
  }, [settings]);

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
    });
  };

  const handleTitleChange = (value) => {
    setTitleType(value);
    save({
      adult_content_level: showAdultContent,
      currency: currencyObject,
      titleType: value,
    });
  };

  const handleCurrencyChange = (code) => {
    const nextCurrency = { code };
    setCurrencyObject(nextCurrency);
    save({
      adult_content_level: showAdultContent,
      currency: nextCurrency,
      titleType,
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

      <div className="space-y-6">
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
