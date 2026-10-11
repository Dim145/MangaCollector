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
// 分 · Loaders for each language's core and per-page chunks, generated at
// build time from `en.js` / `fr.js` / `es.js` by `plugins/i18n-split.js`
// following `split.js`.
import { chunks as CHUNK_LOADERS, core as CORE_LOADERS } from "virtual:mc-i18n";

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
 * language to every visitor, and each language is itself cut in two
 * (`split.js`): the core, which `loadLanguage(lang)` fetches and the
 * first render waits for, and per-page chunks, which a page's loader
 * fetches with the page (`loadNamespaces`, called by `routePages.js`).
 */

export const LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "es", label: "Español", flag: "🇪🇸" },
];

// Module-scoped cache of resolved bundles: language → the catalogue
// merged so far (the core plus every chunk loaded for it). Read by
// `I18nProvider` at call time, so a chunk that lands later is visible to
// the next `t()` without a new provider value.
const BUNDLES = {};
// Loads in flight or done, by `lang/chunk` — so nothing is fetched twice.
const PENDING = new Map();
// Every chunk a page has asked for in this session. A language switch
// loads them all for the new language before the provider flips, so the
// page on screen does not fall back to raw keys.
const WANTED = new Set();
// The languages the interface may be drawn in right now: the one on
// screen, plus the one being switched to while it loads.
const IN_USE = new Set();

// Own keys only: a stored "constructor" must not pass for a language.
const isLanguage = (lang) => typeof lang === "string" && Object.hasOwn(CORE_LOADERS, lang);

function merge(lang, part) {
  Object.assign((BUNDLES[lang] ??= {}), part);
}

function loadPart(lang, chunk) {
  const key = `${lang}/${chunk}`;
  if (!PENDING.has(key)) {
    const loader = !isLanguage(lang)
      ? null
      : chunk === "core"
        ? CORE_LOADERS[lang]
        : Object.hasOwn(CHUNK_LOADERS, chunk)
          ? CHUNK_LOADERS[chunk][lang]
          : null;
    if (!loader) return Promise.reject(new Error(`i18n: no chunk "${chunk}" for "${lang}"`));
    PENDING.set(
      key,
      loader().then(
        (mod) => merge(lang, mod.default),
        (error) => {
          // A failed chunk (offline, a deploy replaced it) is retried by
          // the next caller rather than remembered as broken.
          PENDING.delete(key);
          throw error;
        },
      ),
    );
  }
  return PENDING.get(key);
}

/**
 * Resolve a language's core, plus every page chunk this session has
 * already needed, fetching what is missing. Returns the bundle.
 *
 * 一 · One catalogue, not two. This used to co-load English alongside
 * whatever was asked for, so that `t()`'s fallback would be there
 * synchronously if a translation were missing. But none is: the three
 * catalogues carry the same keys, and `parity.test.js` fails the build
 * if that ever stops being true. The fallback itself stays: if a key
 * really is missing and English happens to be loaded, it still answers.
 */
export async function loadLanguage(lang) {
  const code = isLanguage(lang) ? lang : "en";
  IN_USE.add(code);
  await Promise.all([
    loadPart(code, "core"),
    ...[...WANTED].map((chunk) => loadPart(code, chunk)),
  ]);
  return BUNDLES[code];
}

/**
 * Load page chunks (names from `split.js`) for every language in use.
 * Resolves once they are merged; a page renders after it, so its first
 * `t()` finds its text.
 */
export function loadNamespaces(chunks) {
  for (const chunk of chunks) WANTED.add(chunk);
  const langs = IN_USE.size ? [...IN_USE] : [bootstrapLanguage()];
  return Promise.all(langs.flatMap((lang) => chunks.map((chunk) => loadPart(lang, chunk))));
}

/**
 * The provider now shows `lang`: stop loading page chunks for any other
 * language. Called once a switch has landed.
 */
export function settleLanguage(lang) {
  IN_USE.clear();
  IN_USE.add(isLanguage(lang) ? lang : "en");
}

/**
 * Every page chunk of the languages in use — for the idle moment after
 * the first screen, so a page never visited online still has its text
 * offline (the service worker keeps what was fetched).
 */
export function loadAllNamespaces() {
  return loadNamespaces(Object.keys(CHUNK_LOADERS));
}

const I18nContext = createContext({
  lang: "en",
  t: (k) => k,
});

function resolve(bundle, path) {
  const parts = path.split(".");
  let cur = bundle;
  for (const p of parts) {
    // 鍵 · Own properties only. A dotted key is a path into the bundle,
    // and nothing on `Object.prototype` is a translation — without this
    // a key like `constructor.name` or `toString` resolves to a built-in
    // and the UI renders `function Object() { [native code] }` where a
    // sentence should be. Reads only, so there was never anything to
    // pollute here; the cost of the wrong answer is the reason.
    if (cur == null || typeof cur !== "object" || !Object.hasOwn(cur, p)) {
      return null;
    }
    // The rule below matches `x = x[k]` in a loop on sight. This one
    // only reads, and the `Object.hasOwn` above already stops it at the
    // prototype boundary — there is nothing here to assign to.
    // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
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
    const t = (key, params) => {
      // Read at call time: a page chunk merged after this value was
      // made is already there.
      let v = resolve(BUNDLES[lang] ?? BUNDLES.en, key);
      if (v == null) v = resolve(BUNDLES.en, key);
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
    // 語 · Against the loaders, not `BUNDLES`. `BUNDLES` holds the
    // catalogues already *resolved*, and at bootstrap it is empty by
    // definition — so this asked "is French loaded?" before anything
    // could be, always answered no, and started every reader in
    // English. A French reader then paid for two catalogues (English
    // first, then French when the settings arrived) and watched the
    // first screen switch language under them.
    if (isLanguage(stored)) return stored;
  } catch {
    /* ignore */
  }
  return "en";
}

export function rememberLanguage(lang) {
  try {
    if (isLanguage(lang)) {
      localStorage.setItem("mc:lang", lang);
      if (typeof document !== "undefined") {
        document.documentElement.lang = lang;
      }
    }
  } catch {
    /* ignore */
  }
}
