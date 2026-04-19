/*
 * Theme applier.
 *
 * Three user preferences:
 *   - 'dark'  → always the ink / hanko dark palette
 *   - 'light' → always the washi-paper light palette
 *   - 'auto'  → follow the OS preference via prefers-color-scheme, and
 *               track live changes while the preference is active
 *
 * The actual colour swap lives in CSS — this module just flips the
 * `data-theme` attribute on <html> to "light" (or unsets it for dark).
 *
 * Meta `theme-color` is also updated so mobile address bars / PWA splash
 * stay in sync with the current palette.
 */

const THEME_META = {
  dark: "#161012",
  light: "#f3efe6",
};

let autoMql = null;
let autoHandler = null;

function setResolvedTheme(resolved) {
  const root = document.documentElement;
  if (resolved === "light") {
    root.setAttribute("data-theme", "light");
  } else {
    root.removeAttribute("data-theme");
  }

  // Update the meta tag for mobile browsers
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", THEME_META[resolved] ?? THEME_META.dark);

  // Hint UA for form controls (scrollbars, date pickers, etc.)
  root.style.colorScheme = resolved;
}

function detachAutoListener() {
  if (autoMql && autoHandler) {
    autoMql.removeEventListener?.("change", autoHandler);
    autoMql.removeListener?.(autoHandler); // Safari < 14
  }
  autoMql = null;
  autoHandler = null;
}

/**
 * Apply a user preference. Accepts 'dark', 'light', 'auto' — any other
 * value falls back to 'dark'. In 'auto' mode, the module installs a
 * media-query listener so the palette tracks the OS in real-time.
 */
export function applyThemePreference(pref) {
  const preference = ["dark", "light", "auto"].includes(pref) ? pref : "dark";

  detachAutoListener();

  if (preference === "auto") {
    autoMql = window.matchMedia("(prefers-color-scheme: light)");
    autoHandler = (e) => setResolvedTheme(e.matches ? "light" : "dark");
    autoMql.addEventListener?.("change", autoHandler);
    autoMql.addListener?.(autoHandler); // Safari < 14
    setResolvedTheme(autoMql.matches ? "light" : "dark");
    return;
  }

  setResolvedTheme(preference);
}

/**
 * Apply a theme preference as early as possible (before React renders) so
 * the first paint doesn't flash the wrong palette. Call from main.jsx.
 *
 * We read the last-known preference from localStorage as a hint — the real
 * value comes from the server via settings, but that round-trip would flash
 * a wrong theme for a few hundred ms.
 */
export function bootstrapThemeFromStorage() {
  try {
    const stored = localStorage.getItem("mc:theme");
    if (stored) applyThemePreference(stored);
  } catch {
    /* ignore */
  }
}

/** Persist the preference locally so next cold-start renders correctly. */
export function rememberThemePreference(pref) {
  try {
    localStorage.setItem("mc:theme", pref);
  } catch {
    /* ignore */
  }
}
