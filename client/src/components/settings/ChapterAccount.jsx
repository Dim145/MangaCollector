import { useState } from "react";
import { Link } from "react-router-dom";
import PublicProfileSection from "@/components/PublicProfileSection.jsx";
import BirthdayModeSection from "@/components/BirthdayModeSection.jsx";
import ArchiveSection from "@/components/ArchiveSection.jsx";
import WelcomeTour from "@/components/WelcomeTour.jsx";
import { resetTourSeen } from "@/lib/tour.js";
import { getApiKey } from "@/lib/isbn.js";
import { useT } from "@/i18n/index.jsx";
import { Card, CardHeader, Chapter, SubBlock } from "./_shared.jsx";

export default function ChapterAccount({
  chapter,
  subBlocks,
  t,
  apiKeyInput,
  setApiKeyInput,
  apiKeyRevealed,
  setApiKeyRevealed,
  apiKeySaved,
  onApiKeySave,
  onApiKeyClear,
}) {
  // ─── Ch. 3 · Compte ────────────────────────────────────
  // Three sub-blocks ordered by intent:
  //   公 Public  — what other people see (profile, birthday)
  //   具 Outils  — utilities for your library (archive,
  //               shelf stickers, barcode scanner key)
  //   助 Aide    — onboarding tour + glossary entry point
  // Scanner key moved here from Ch. 2 because it's a
  // personal credential for an external tool, not a content
  // preference.
  return (
    <Chapter
      id="account"
      chapter={chapter}
      title={t("settings.tabAccount")}
      subtitle={t("settings.tabAccountHint")}
      t={t}
    >
      <SubBlock block={subBlocks.publicShare} t={t}>
        <PublicProfileSection />
        <BirthdayModeSection />
      </SubBlock>

      <SubBlock block={subBlocks.tools} t={t}>
        <ArchiveSection />
        <ShelfStickersEntry t={t} />
        <ScannerKeySection
          apiKey={apiKeyInput}
          setApiKey={setApiKeyInput}
          revealed={apiKeyRevealed}
          setRevealed={setApiKeyRevealed}
          saved={apiKeySaved}
          onSave={onApiKeySave}
          onClear={onApiKeyClear}
          t={t}
        />
      </SubBlock>

      <SubBlock block={subBlocks.help} t={t}>
        <OnboardingSection />
      </SubBlock>
    </Chapter>
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
