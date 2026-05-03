/**
 * 暦 · Locale-aware date / time / relative-time formatters.
 *
 * Centralises four near-identical copies that drifted across
 * `SnapshotsPage`, `LoansWidget`, `LoanModal`, and `FriendsPage`.
 * Adding a new language used to mean editing every formatter; now
 * `localeFor` is the single point to extend.
 *
 * Every helper:
 *   - Accepts an ISO string, a `Date`, or a number (epoch ms).
 *   - Returns "" on falsy/invalid input — callers can render the
 *     result directly without a guard.
 *   - Falls back to en-US silently if the runtime can't honour the
 *     requested locale (the project supports en/fr/es; anything else
 *     means a future locale that hasn't been wired up yet).
 */

const SUPPORTED_LOCALES = {
  fr: "fr-FR",
  en: "en-US",
  es: "es-ES",
};

/**
 * Map a project lang code (`fr` / `en` / `es`) to a BCP-47 tag the
 * `Intl` API can consume. Defaults to `en-US`.
 */
export function localeFor(lang) {
  return SUPPORTED_LOCALES[lang] ?? SUPPORTED_LOCALES.en;
}

function toDate(value) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Short date: `15 mars 2026` / `Mar 15, 2026` / `15 mar 2026`.
 */
export function formatShortDate(value, lang) {
  const d = toDate(value);
  if (!d) return "";
  try {
    return d.toLocaleDateString(localeFor(lang), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return d.toLocaleDateString();
  }
}

/**
 * Compact date — same as `formatShortDate` but with a 2-digit year
 * (`15 mars 26` / `Mar 15, '26`). Used in tight UI surfaces like the
 * loan widget pill where four digits would crowd the layout.
 */
export function formatCompactDate(value, lang) {
  const d = toDate(value);
  if (!d) return "";
  try {
    return d.toLocaleDateString(localeFor(lang), {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    });
  } catch {
    return d.toLocaleDateString();
  }
}

/**
 * Long date: `vendredi 15 mars 2026` / `Friday, March 15, 2026`.
 */
export function formatLongDate(value, lang) {
  const d = toDate(value);
  if (!d) return "";
  try {
    return d.toLocaleDateString(localeFor(lang), {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return d.toLocaleDateString();
  }
}

/**
 * Time of day: `14:32` / `2:32 PM` per locale convention.
 */
export function formatTime(value, lang) {
  const d = toDate(value);
  if (!d) return "";
  try {
    return d.toLocaleTimeString(localeFor(lang), {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return d.toLocaleTimeString();
  }
}

/**
 * Relative-time formatter — uses `Intl.RelativeTimeFormat` so the
 * result reads idiomatically per locale ("il y a 3 jours" vs.
 * "3 days ago" vs. "hace 3 días"). The formatter caps at "30 days
 * ago" and falls back to `formatShortDate` for older values.
 */
export function formatRelative(value, lang) {
  const d = toDate(value);
  if (!d) return "";
  const diffMs = d.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const absSec = Math.abs(diffSec);

  let rtf;
  try {
    rtf = new Intl.RelativeTimeFormat(localeFor(lang), { numeric: "auto" });
  } catch {
    return formatShortDate(value, lang);
  }

  if (absSec < 60) return rtf.format(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, "hour");
  const diffDay = Math.round(diffHour / 24);
  if (Math.abs(diffDay) <= 30) return rtf.format(diffDay, "day");

  return formatShortDate(value, lang);
}
