import { createContext, useContext, useMemo } from "react";
import en from "./en.js";
import fr from "./fr.js";
import es from "./es.js";

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
 */

export const LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "es", label: "Español", flag: "🇪🇸" },
];

const BUNDLES = { en, fr, es };

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
  return String(str).replace(/\{(\w+)\}/g, (_, k) =>
    params[k] != null ? String(params[k]) : `{${k}}`
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
