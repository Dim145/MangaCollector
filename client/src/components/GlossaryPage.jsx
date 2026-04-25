import { useState } from "react";
import { Link } from "react-router-dom";
import DefaultBackground from "./DefaultBackground.jsx";
import { useT } from "@/i18n/index.jsx";

/**
 * 字典 · Kanji glossary.
 *
 * The Shōjo-Noir identity is built on a small alphabet of Japanese
 * characters that surface across the app — filters, badges, supertitles,
 * the colour palette itself. This page documents that alphabet so a
 * user who lands cold on a 願 or an 印鑑帳 can understand where the
 * character lives, what it literally means, and what role it plays in
 * MangaCollector's vocabulary.
 *
 * Public route (no auth) — onboarding, marketing, and reference all in
 * the same place.
 */

// Each entry resolves its translatable strings via i18n keys, but the
// kanji themselves stay co-located here as constants — they're identity,
// not copy. Categories deliberately keep small (4-6 entries) so the
// page reads as a series of breathable plates rather than a wall.
const SECTIONS = [
  {
    id: "states",
    kanji: "状態",
    romaji: "jōtai",
    entries: [
      { char: "全", romaji: "zen" },
      { char: "進", romaji: "shin" },
      { char: "願", romaji: "negai" },
      { char: "完", romaji: "kan" },
      { char: "積読", romaji: "tsundoku" },
      { char: "限", romaji: "gen" },
    ],
  },
  {
    id: "actions",
    kanji: "行動",
    romaji: "kōdō",
    entries: [
      { char: "始", romaji: "hajime" },
      { char: "探", romaji: "sagasu" },
      { char: "印", romaji: "in" },
      { char: "追加", romaji: "tsuika" },
      { char: "編集", romaji: "henshū" },
    ],
  },
  {
    id: "places",
    kanji: "場所",
    romaji: "basho",
    entries: [
      { char: "本棚", romaji: "hondana" },
      { char: "蔵書", romaji: "zōsho" },
      { char: "統計", romaji: "tōkei" },
      { char: "設定", romaji: "settei" },
      { char: "読破", romaji: "dokuha" },
    ],
  },
  {
    id: "vessels",
    kanji: "道具",
    romaji: "dōgu",
    entries: [
      { char: "巻", romaji: "kan" },
      { char: "盒", romaji: "gō" },
      { char: "印鑑帳", romaji: "inkanchō" },
      { char: "あと少し", romaji: "ato sukoshi" },
    ],
  },
  {
    id: "palette",
    kanji: "色",
    romaji: "iro",
    entries: [
      { char: "漆黒", romaji: "shikkoku", swatch: "ink" },
      { char: "印", romaji: "hanko", swatch: "hanko" },
      { char: "金", romaji: "kin", swatch: "gold" },
      { char: "萌葱", romaji: "moegi", swatch: "moegi" },
      { char: "桜", romaji: "sakura", swatch: "sakura" },
    ],
  },
];

export default function GlossaryPage() {
  const t = useT();

  return (
    <DefaultBackground>
      <div className="relative mx-auto max-w-6xl px-4 pt-10 pb-nav md:pb-20 sm:px-6 md:pt-16">
        {/* Ornamental watermark — 字 (ji · "character") pinned to the
            top-right corner. Sits behind everything via z-0 and the
            content stack via z-10. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-8 select-none font-display italic font-light leading-none text-hanko/5 md:right-12 md:top-12"
          style={{ fontSize: "clamp(8rem, 22vw, 18rem)" }}
        >
          字
        </span>

        {/* Masthead */}
        <header className="relative z-10 animate-fade-up">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.3em] text-washi-dim">
              {t("glossary.kicker")}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>
          <h1 className="mt-3 font-display text-4xl font-light italic leading-none tracking-tight text-washi md:text-6xl">
            {t("glossary.headingPre")}{" "}
            <span className="text-hanko-gradient font-semibold not-italic">
              {t("glossary.headingAccent")}
            </span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm text-washi-muted md:text-base">
            {t("glossary.intro")}
          </p>
        </header>

        {/* Sections */}
        <div className="relative z-10 mt-12 space-y-14 md:mt-16 md:space-y-20">
          {SECTIONS.map((section, sIdx) => (
            <section
              key={section.id}
              className="animate-fade-up"
              style={{ animationDelay: `${120 + sIdx * 80}ms` }}
            >
              {/* Section header — kanji on the left, brush divider trailing
                  to the right. Mirrors the supertitle pattern used across
                  the rest of the app. */}
              <header className="flex items-baseline gap-4">
                <span
                  className="font-jp text-3xl font-bold leading-none text-hanko md:text-4xl"
                  aria-hidden="true"
                >
                  {section.kanji}
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-washi-dim">
                    {section.romaji} · {t(`glossary.sec_${section.id}_kicker`)}
                  </p>
                  <h2 className="font-display text-xl font-semibold italic text-washi md:text-2xl">
                    {t(`glossary.sec_${section.id}_title`)}
                  </h2>
                </div>
                <span className="ml-auto h-px flex-1 max-w-[40%] bg-gradient-to-r from-border to-transparent" />
              </header>

              {/* Entry grid — 1 / 2 / 3 columns scales for line-length so a
                  card never stretches wider than a comfortable reading
                  measure for the body copy. */}
              <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {section.entries.map((entry, eIdx) => (
                  <li
                    key={entry.char}
                    className="animate-fade-up"
                    style={{
                      animationDelay: `${180 + sIdx * 80 + eIdx * 50}ms`,
                    }}
                  >
                    <KanjiCard entry={entry} sectionId={section.id} t={t} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* Footer — back-to-home link + the same micro-credit pattern as
            the public profile so the page feels rooted in the app even
            when reached from a deep link. */}
        <footer className="relative z-10 mt-20 flex flex-col items-center gap-3 border-t border-border pt-10 text-center">
          <span
            aria-hidden="true"
            className="font-jp text-base text-hanko/40 tracking-[0.4em]"
          >
            字
          </span>
          <Link
            to="/"
            className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim transition hover:text-hanko"
          >
            ← {t("glossary.backHome")}
          </Link>
        </footer>
      </div>
    </DefaultBackground>
  );
}

/**
 * Single kanji card. The character is the hero, romaji a quiet caption,
 * and the two paragraphs split into "literal sense" and "in this app" so
 * the user can scan either side independently. The optional swatch
 * variant adds a colour chip for entries that name a palette token —
 * 漆黒 (jet ink), 萌葱 (spring shoot), etc. — turning the page into a
 * dual-purpose colour reference.
 */
function KanjiCard({ entry, sectionId, t }) {
  const literal = t(`glossary.${sectionId}_${entry.char}_literal`);
  const usage = t(`glossary.${sectionId}_${entry.char}_usage`);

  return (
    <div className="group relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-5 backdrop-blur transition hover:-translate-y-0.5 hover:border-hanko/40 md:p-6">
      {/* Hover-revealed brush stroke — a low-opacity gradient that fades
          in under the kanji to evoke the wet ink of a sumi brush. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-12 left-0 right-0 h-24 bg-gradient-to-t from-hanko/15 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100"
      />

      <div className="flex items-baseline gap-3">
        <span
          className="font-jp text-5xl font-bold leading-none text-washi transition-transform duration-500 group-hover:scale-110 md:text-6xl"
          aria-hidden="true"
        >
          {entry.char}
        </span>
        <div className="min-w-0">
          <p className="font-display text-base italic text-hanko-bright">
            {entry.romaji}
          </p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
            {literal}
          </p>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-washi-muted">{usage}</p>

      {/* Optional palette swatch — only rendered for the 色 section. */}
      {entry.swatch && <ColourSwatch token={entry.swatch} t={t} />}
    </div>
  );
}

/**
 * Click-to-copy colour swatch.
 *
 * The swatch *is* the interaction: the user clicks the colour itself,
 * which copies the CSS variable reference to the clipboard. We don't
 * render `var(--hanko)` as a tiny mono caption — it would read as a
 * leaked debug string. Instead, the caption flips to "✓ copied" for
 * ~1.6s after the action, providing the only feedback the user needs.
 *
 * The token name is the implementation detail; the user never has to
 * read it to use the page (it's whispered in `aria-label` and `title`
 * for power users).
 */
function ColourSwatch({ token, t }) {
  const [copied, setCopied] = useState(false);
  // Map declarative token names to the live CSS variable so the swatch
  // tracks the active theme (light/dark + seasonal tints).
  const tone = {
    ink: "var(--ink-0)",
    hanko: "var(--hanko)",
    gold: "var(--gold)",
    moegi: "var(--moegi)",
    sakura: "var(--sakura)",
  }[token];
  if (!tone) return null;

  const cssRef = `var(--${token === "ink" ? "ink-0" : token})`;
  const ariaLabel = t("glossary.copyAria", { token: cssRef });

  const handleCopy = async () => {
    try {
      // Modern path — async clipboard API, requires a secure context
      // (HTTPS or localhost). The site runs over HTTPS in prod and is
      // localhost-only in dev, so this is the path everyone takes.
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(cssRef);
      } else {
        // Legacy fallback for browsers without async clipboard. A
        // momentary textarea is the path recommended by MDN; it's
        // visually invisible and removed before the next paint.
        const ta = document.createElement("textarea");
        ta.value = cssRef;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard denied (permissions, iframe sandbox, etc.) — fail
         silently rather than dumping a permission error on the user. */
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={ariaLabel}
      title={ariaLabel}
      className="group/swatch relative mt-auto block w-full overflow-hidden rounded-xl border border-border bg-ink-0/30 transition hover:border-hanko/40 focus-visible:border-hanko focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hanko/40"
    >
      {/* Colour pane — takes the full card width so the swatch reads as
          a paint stripe, not a chip. Subtle inner shadow gives it depth
          without competing with the kanji above. */}
      <span
        aria-hidden="true"
        className="block h-10 w-full transition-transform duration-300 group-hover/swatch:scale-[1.02]"
        style={{
          background: tone,
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.25)",
        }}
      />

      {/* Caption row — micro mono text under the paint, switches between
          "tap to copy" and "✓ copied" on action. The state lives at
          this level so the swatch can keep its own visual breathing
          room even while the label changes. */}
      <span className="flex items-center justify-center gap-1.5 border-t border-border/60 bg-ink-1/40 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.3em]">
        {copied ? (
          <>
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-2.5 w-2.5 animate-fade-in text-hanko-bright"
              aria-hidden="true"
            >
              <polyline points="3 8.5 7 12 13 4.5" />
            </svg>
            <span className="animate-fade-in text-hanko-bright">
              {t("glossary.copied")}
            </span>
          </>
        ) : (
          <span className="text-washi-dim transition-colors group-hover/swatch:text-washi">
            {t("glossary.tapToCopy")}
          </span>
        )}
      </span>
    </button>
  );
}
