import { useEffect, useRef, useState } from "react";
import { getUserSettings, updateSettings } from "@/utils/user.js";
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

export default function SettingsPage({ settingsUpdateCallback }) {
  const [showAdultContent, setShowAdultContent] = useState(0);
  const [currencyObject, setCurrencyObject] = useState(null);
  const [titleType, setTitleType] = useState("Default");
  const [saved, setSaved] = useState(false);
  const fetching = useRef(true);

  useEffect(() => {
    (async () => {
      const settings = await getUserSettings(true);
      setShowAdultContent(settings?.adult_content_level || 0);
      setCurrencyObject(settings?.currency);
      setTitleType(settings?.titleType || "Default");
      setTimeout(() => (fetching.current = false), 100);
    })();
  }, []);

  useEffect(() => {
    async function save() {
      try {
        const next = {
          adult_content_level: showAdultContent,
          currency: currencyObject,
          titleType,
        };
        await updateSettings(next);
        settingsUpdateCallback?.(next);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } catch (error) {
        console.error("Error updating setting:", error);
      }
    }
    if (!fetching.current) save();
  }, [showAdultContent, titleType]);

  const handleCurrencyChange = async (code) => {
    const res = await updateSettings({
      adult_content_level: showAdultContent,
      currency: { code },
      titleType,
    });
    settingsUpdateCallback?.(res);
    setCurrencyObject(res.currency);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="mx-auto max-w-2xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
      {/* Header */}
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
        {/* Adult content */}
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
                  onChange={() => setShowAdultContent(opt.value)}
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

        {/* Currency */}
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

        {/* Title type */}
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
                  onChange={() => setTitleType(opt.value)}
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
      </div>
    </div>
  );
}
