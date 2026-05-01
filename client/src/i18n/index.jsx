/* eslint-disable react-refresh/only-export-components --
 * This module is the app's i18n hub. It co-locates on purpose:
 *   • the `I18nProvider` component
 *   • the `useT` / `useLang` hooks (consumed by every translated
 *     component)
 *   • the `LANGUAGES` constant (used by the Settings picker)
 *   • the `bootstrap*` / `remember*` helpers (used at app init
 *     before React mounts, to pick the right bundle without FOUC)
 *
 * react-refresh/only-export-components flags this file because it
 * exports non-component values alongside a component — that breaks
 * HMR for this specific file in dev. Splitting into 4 files would
 * fix the warning but fragment a tight, cohesive API. HMR impact
 * is development-only; the runtime behaviour is identical. The
 * trade-off is worth it for readability.
 */
import { createContext, useContext, useMemo } from "react";

/*
 * Lightweight i18n — no external dependency, ~1 KB runtime.
 *
 *   const t = useT();
 *   t('dashboard.title')                     → "Your Library"
 *   t('scan.foundVolume', { title, n: 5 })   → "Found One Piece · Vol 5…"
 *
 * Keys are dot-paths resolved against the bundle for the active language;
 * missing keys fall back to the English bundle, and finally to the raw
 * key string so something is always rendered.
 *
 * `{placeholder}` tokens in the strings are replaced with params values.
 *
 * Bundles are LAZY-LOADED so the main JS chunk doesn't ship every
 * language to every visitor. The English bundle is treated specially as
 * the fallback for missing keys — `loadLanguage(lang)` resolves once
 * the requested bundle (and English, if different) is in cache, and
 * the React render must wait on that promise before mounting the
 * provider. Each `import(...)` resolves to its own code-split chunk.
 */

export const LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "es", label: "Español", flag: "🇪🇸" },
];

const LOADERS = {
  en: () => import("./en.js"),
  fr: () => import("./fr.js"),
  es: () => import("./es.js"),
};

// Module-scoped cache of resolved bundles. Populated as `loadLanguage`
// resolves; read synchronously by `I18nProvider` from that point on.
// Mutated through `loadLanguage` rather than directly.
const BUNDLES = {};

/**
 * Resolve a language's bundle, fetching its chunk on first call and
 * caching it for subsequent calls. Returns the bundle object so callers
 * can also do their own thing with it; the side-effect of populating
 * `BUNDLES[lang]` is what `I18nProvider` actually reads from later.
 *
 * Always co-loads English when the requested lang isn't English — the
 * `t()` helper falls back to English for missing keys, and we want
 * that fallback to be synchronous (no flash of raw keys) once the
 * provider is mounted.
 */
export async function loadLanguage(lang) {
  const code = LOADERS[lang] ? lang : "en";
  const tasks = [];
  if (!BUNDLES[code]) {
    tasks.push(
      LOADERS[code]().then((mod) => {
        BUNDLES[code] = mod.default;
      }),
    );
  }
  if (code !== "en" && !BUNDLES.en) {
    tasks.push(
      LOADERS.en().then((mod) => {
        BUNDLES.en = mod.default;
      }),
    );
  }
  if (tasks.length) await Promise.all(tasks);
  return BUNDLES[code];
}

const I18nContext = createContext({
  lang: "en",
  t: (k) => k,
});

function resolve(bundle, path) {
  const parts = path.split(".");
  let cur = bundle;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[p];
  }
  return cur;
}

function interpolate(str, params) {
  if (!params) return str;
  // `\{` stays escaped (some regex linters tolerate it because `{n,m}`
  // quantifiers exist); `}` doesn't need escaping outside that context,
  // so the trailing `\}` was redundant — Qodana RegExpRedundantEscape.
  return String(str).replace(/\{(\w+)}/g, (_, k) =>
    params[k] != null ? String(params[k]) : `{${k}}`,
  );
}

export function I18nProvider({ lang, children }) {
  const value = useMemo(() => {
    const primary = BUNDLES[lang] ?? BUNDLES.en;
    const fallback = BUNDLES.en;
    const t = (key, params) => {
      let v = resolve(primary, key);
      if (v == null) v = resolve(fallback, key);
      if (typeof v !== "string") return key;
      return interpolate(v, params);
    };
    return { lang, t };
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext).t;
}

export function useLang() {
  return useContext(I18nContext).lang;
}

/**
 * Reads the last-known language from localStorage. Used at app init so
 * the very first React render uses the right bundle instead of flashing
 * English while settings load from the server.
 */
export function bootstrapLanguage() {
  try {
    const stored = localStorage.getItem("mc:lang");
    if (stored && BUNDLES[stored]) return stored;
  } catch {
    /* ignore */
  }
  return "en";
}

export function rememberLanguage(lang) {
  try {
    if (BUNDLES[lang]) {
      localStorage.setItem("mc:lang", lang);
      if (typeof document !== "undefined") {
        document.documentElement.lang = lang;
      }
    }
  } catch {
    /* ignore */
  }
}
