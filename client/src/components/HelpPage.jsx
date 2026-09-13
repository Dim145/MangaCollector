import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Markdown from "./ui/Markdown.jsx";
import { useT, useLang } from "@/i18n/index.jsx";
import { parseMarkdown, tableOfContents } from "@/lib/markdown.js";

/**
 * 助 · The help page. The prose lives in `src/content/help.<lang>.md`,
 * one file per language, fetched only when someone opens the page —
 * writing help should be writing prose, not editing a translation
 * table. The renderer builds React nodes from parsed blocks, so the
 * page never injects markup.
 */

const LOADERS = {
  en: () => import("@/content/help.en.md?raw"),
  fr: () => import("@/content/help.fr.md?raw"),
  es: () => import("@/content/help.es.md?raw"),
};

export default function HelpPage() {
  const t = useT();
  const lang = useLang();
  const [source, setSource] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSource(null);
    setFailed(false);
    (LOADERS[lang] ?? LOADERS.en)()
      .then((mod) => {
        if (alive) setSource(mod.default);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [lang]);

  const blocks = useMemo(() => (source ? parseMarkdown(source) : []), [source]);
  const toc = useMemo(() => tableOfContents(blocks), [blocks]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-32 md:pb-16">
      <header className="mb-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-washi-dim">
          {t("help.kicker")}
        </p>
        <h1 className="mt-2 font-display text-4xl font-light italic leading-tight text-washi md:text-5xl">
          {t("help.title")}
        </h1>
        <p className="mt-3 max-w-xl font-display text-lg font-light italic text-washi-muted">
          {t("help.subtitle")}
        </p>
      </header>

      {toc.length > 0 && (
        <nav
          aria-label={t("help.contents")}
          className="mb-10 rounded-md border border-border/70 bg-ink-1/30 p-5"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-washi-dim">
            {t("help.contents")}
          </p>
          <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {toc.map((entry) => (
              <li key={entry.id}>
                <a
                  href={`#${entry.id}`}
                  className="font-display italic text-washi-muted underline-offset-4 hover:text-washi hover:underline"
                >
                  {entry.value}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {failed ? (
        <p className="font-display text-lg font-light italic text-washi-dim">
          {t("help.unavailable")}
        </p>
      ) : source === null ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-washi-dim">
          {t("help.loading")}
        </p>
      ) : (
        <Markdown blocks={blocks} />
      )}

      <footer className="mt-12 border-t border-border/60 pt-6">
        <p className="font-display italic text-washi-muted">
          {t("help.moreLead")}{" "}
          <Link
            to="/glossary"
            className="text-gold underline-offset-4 hover:underline"
          >
            {t("help.moreGlossary")}
          </Link>
          .
        </p>
      </footer>
    </div>
  );
}
