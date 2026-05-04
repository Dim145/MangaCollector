import { LANGUAGES } from "@/i18n/index.jsx";
import { formatCurrency } from "@/utils/price.js";
import { Card, CardHeader, Chapter, RadioCard, SubBlock } from "./_shared.jsx";

const CURRENCIES = [
  { code: "USD", key: "USD", flag: "🇺🇸" },
  { code: "EUR", key: "EUR", flag: "🇪🇺" },
];

export default function ChapterContent({
  chapter,
  subBlocks,
  t,
  language,
  onLanguageChange,
  titleOptions,
  titleType,
  onTitleChange,
  currencyObject,
  onCurrencyChange,
  adultOptions,
  showAdultContent,
  onAdultChange,
}) {
  // ─── Ch. 2 · Contenu ───────────────────────────────────
  // Two sub-blocks:
  //   言 Langues   — what tongue the UI / titles speak
  //   表 Affichage — how data is rendered (currency, adult)
  // Scanner API key moved OUT of this chapter (it's a tool,
  // not a content preference) and into Ch. 3 / 具 Outils.
  return (
    <Chapter
      id="content"
      chapter={chapter}
      title={t("settings.tabContent")}
      subtitle={t("settings.tabContentHint")}
      t={t}
    >
      <SubBlock block={subBlocks.language} t={t}>
        <LanguageSection
          value={language}
          onChange={onLanguageChange}
          t={t}
        />
        <TitleLanguageSection
          options={titleOptions}
          value={titleType}
          onChange={onTitleChange}
          t={t}
        />
      </SubBlock>

      <SubBlock block={subBlocks.display} t={t}>
        <CurrencySection
          currency={currencyObject}
          onChange={onCurrencyChange}
          t={t}
        />
        <AdultContentSection
          options={adultOptions}
          value={showAdultContent}
          onChange={onAdultChange}
          t={t}
        />
      </SubBlock>
    </Chapter>
  );
}

function LanguageSection({ value, onChange, t }) {
  return (
    <Card>
      <CardHeader
        title={t("settings.language")}
        body={t("settings.languageBody")}
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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

function AdultContentSection({ options, value, onChange, t }) {
  return (
    <Card>
      <CardHeader
        title={t("settings.adultContent")}
        body={t("settings.adultBody")}
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
