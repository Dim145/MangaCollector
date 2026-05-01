/*
 * 朱 · Accent palette catalogue (frontend mirror).
 *
 * Authoritative list lives server-side (`services/settings.rs::
 * VALID_ACCENT_COLORS` + the CHECK constraint on settings.accent_color).
 * This file just rolls in the human-readable labels + preview swatches
 * the Settings UI needs to render the picker.
 *
 * Each entry's `name` matches the DB-stored value exactly. Re-ordering
 * here changes the picker order; renaming would desync the validation
 * — keep the keys stable.
 *
 * Swatches use the same OKLCH values as the matching `:root[data-accent="…"]`
 * block in styles/index.css so the picker chip is a faithful preview
 * of what the rest of the UI will become on selection.
 */

export const DEFAULT_ACCENT = "shu";

export const ACCENTS = [
  {
    name: "shu",
    kanji: "朱",
    label: "Shu",
    swatch: "oklch(0.6 0.22 25)",
    description: "Hanko red — the default seal stamp.",
  },
  {
    name: "kin",
    kanji: "金",
    label: "Kin",
    swatch: "oklch(0.78 0.15 78)",
    description: "Gold leaf.",
  },
  {
    name: "moegi",
    kanji: "萌葱",
    label: "Moegi",
    swatch: "oklch(0.7 0.18 140)",
    description: "Spring shoot.",
  },
  {
    name: "sakura",
    kanji: "桜",
    label: "Sakura",
    swatch: "oklch(0.78 0.13 12)",
    description: "Cherry blossom.",
  },
  {
    name: "ai",
    kanji: "藍",
    label: "Ai",
    swatch: "oklch(0.58 0.16 250)",
    description: "Indigo.",
  },
  {
    name: "kuro",
    kanji: "黒",
    label: "Kuro",
    swatch: "oklch(0.5 0.06 60)",
    description: "Lacquer black, warm.",
  },
  {
    name: "murasaki",
    kanji: "紫",
    label: "Murasaki",
    swatch: "oklch(0.56 0.18 310)",
    description: "Royal purple.",
  },
  {
    name: "akane",
    kanji: "茜",
    label: "Akane",
    swatch: "oklch(0.58 0.2 15)",
    description: "Madder red.",
  },
];

const ACCENT_NAMES = new Set(ACCENTS.map((a) => a.name));

/**
 * Apply an accent name to <html data-accent>. Pass `null`, `undefined`,
 * an empty string, or `"shu"` to clear the attribute and fall back to
 * the default palette baked into `:root` (which already carries the
 * shu/hanko tokens).
 */
export function applyAccentToDocument(name) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!name || name === DEFAULT_ACCENT || !ACCENT_NAMES.has(name)) {
    root.removeAttribute("data-accent");
  } else {
    root.setAttribute("data-accent", name);
  }
}

const STORAGE_KEY = "mc:accent";

/**
 * Stash the current pick to localStorage so the very first paint on
 * the next cold-start uses the user's accent — without waiting for
 * the settings round-trip. Authoritative source remains the DB.
 */
export function rememberAccent(name) {
  if (typeof localStorage === "undefined") return;
  try {
    if (name) localStorage.setItem(STORAGE_KEY, name);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode / quota — non-fatal */
  }
}

export function readRememberedAccent() {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Cold-start path — runs before React mounts via main.jsx so the very
 * first frame paints with the user's accent. Mirrors the pattern in
 * `lib/theme.js` / `bootstrapThemeFromStorage`.
 */
export function bootstrapAccentFromStorage() {
  const remembered = readRememberedAccent();
  if (remembered) applyAccentToDocument(remembered);
}
