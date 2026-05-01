/*
 * 貼 · Heuristic detector for "useful" pasted strings.
 *
 * The Add page intercepts paste events on its search input and runs
 * the pasted text through this module. When a known shape is
 * detected (MAL / MangaDex / AniList URL, ISBN), the input pre-fills
 * with a sanitised query and the search auto-runs — no extra tap.
 *
 * Returns `null` when nothing recognisable is found, in which case
 * the caller should let the native paste behaviour proceed
 * unchanged. Recognition is intentionally permissive (whitespace
 * trimmed, scheme optional for URLs) — false negatives feel worse
 * than the cost of trying.
 */

const MAL_RE =
  /(?:https?:\/\/)?(?:www\.)?myanimelist\.net\/manga\/(\d+)(?:\/([^/?#]+))?/i;
const MANGADEX_RE =
  /(?:https?:\/\/)?(?:www\.)?mangadex\.org\/title\/([a-f0-9-]{8,})(?:\/([^/?#]+))?/i;
const ANILIST_RE =
  /(?:https?:\/\/)?(?:www\.)?anilist\.co\/manga\/(\d+)(?:\/([^/?#]+))?/i;

// 10- or 13-digit ISBN with optional hyphens / spaces. The check
// rejects strings that contain anything else so a stray digit run
// inside a sentence doesn't get hijacked. Caller should trim first.
const ISBN_RE = /^(?:\d[\d-\s]{8,16}\d)$/;

/**
 * Decode a URL slug back into something a fuzzy text search can use.
 * `Demon-Slayer-Kimetsu_no_Yaiba` → `Demon Slayer Kimetsu no Yaiba`.
 * Returns the empty string when the slug is unusable.
 */
function slugToQuery(slug) {
  if (!slug) return "";
  try {
    return decodeURIComponent(slug)
      .replace(/[-_+]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    // Malformed percent-encoding — strip the percent escapes and
    // hope for the best rather than throw.
    return slug.replace(/%[0-9a-f]{2}/gi, "").replace(/[-_+]/g, " ").trim();
  }
}

/**
 * Inspect a pasted string and classify it.
 * @returns {{ kind: string, query: string, raw: string } | null}
 *
 * `kind` is one of: "mal" | "mangadex" | "anilist" | "isbn".
 * `query` is the search-ready string the caller should hand to
 * `searchExternal()` (or `lookupISBN()` when kind === "isbn").
 */
export function detectPasteIntent(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Order matters: more specific patterns (URLs with a known host)
  // are tested before the generic ISBN check — pasting a MAL URL
  // that happens to contain a 10-digit substring shouldn't be
  // classified as ISBN.
  let m;

  if ((m = trimmed.match(MAL_RE))) {
    const id = m[1];
    const slug = slugToQuery(m[2]);
    return { kind: "mal", query: slug || id, raw: trimmed };
  }
  if ((m = trimmed.match(MANGADEX_RE))) {
    const id = m[1];
    const slug = slugToQuery(m[2]);
    return { kind: "mangadex", query: slug || id, raw: trimmed };
  }
  if ((m = trimmed.match(ANILIST_RE))) {
    const id = m[1];
    const slug = slugToQuery(m[2]);
    return { kind: "anilist", query: slug || id, raw: trimmed };
  }

  // ISBN: strip separators, validate length 10 or 13, all-digits
  // (last char of ISBN-10 can be 'X' but we keep it strict for
  // paste detection — manual entry remains supported).
  if (ISBN_RE.test(trimmed)) {
    const digits = trimmed.replace(/[\s-]/g, "");
    if (digits.length === 10 || digits.length === 13) {
      return { kind: "isbn", query: digits, raw: trimmed };
    }
  }

  return null;
}
