/**
 * 共有 · Web Share Target — incoming-share helpers.
 *
 * The PWA registers as a share target via the manifest's
 * `share_target` block. When the OS hands a share to the app, it
 * navigates to `/addmanga?share_title=…&share_text=…&share_url=…` —
 * any subset of the three params may be present. This module turns
 * that bag of strings into a single best-guess search query.
 *
 * Decision order:
 *   1. Explicit `title` (trimmed). Most apps fill this when the user
 *      shared a link with a known headline.
 *   2. `text` if it isn't itself just a URL. Free-text shares from
 *      messaging apps land here.
 *   3. URL slug extraction — recognises MAL (`/manga/<id>/<slug>`)
 *      and MangaDex (`/title/<uuid>/<slug>`) explicitly, falls back
 *      to the last path segment for everything else (Amazon, Vinted,
 *      eBay, Booknode, …).
 *   4. Bare URL as last resort — guarantees the search bar is never
 *      left empty when the share carried *some* signal.
 *
 * Returns `null` only when every input was empty / whitespace.
 */

/** Pick the best search-bar query from a Web Share Target payload. */
export function pickShareQuery({ title, text, url } = {}) {
  const t = sanitize(title);
  if (t) return t;

  const txt = sanitize(text);
  if (txt) {
    if (looksLikeUrl(txt)) {
      const fromUrl = extractTitleFromUrl(txt);
      if (fromUrl) return fromUrl;
      return txt;
    }
    return txt;
  }

  const u = sanitize(url);
  if (u) {
    return extractTitleFromUrl(u) ?? u;
  }

  return null;
}

/** Trim + clamp at a sane length so a 50 KB paste doesn't blow up the input. */
function sanitize(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // 200 chars is plenty for any series title and far below the URL
  // bar's practical length budget. The server search will still trim
  // again before hitting MAL.
  return trimmed.slice(0, 200);
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(value);
}

/**
 * Try to surface a human-readable title from a URL. Works for the two
 * sources that drive 95% of shares in this app's domain (MAL,
 * MangaDex) and falls back to the last path segment otherwise.
 *
 * Returns `null` for malformed URLs or paths with no usable segment.
 */
export function extractTitleFromUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  // MyAnimeList: /manga/12345/Tokyo-Ghoul
  const malMatch = parsed.pathname.match(/\/manga\/\d+\/([^/?#]+)/i);
  if (malMatch) return slugToTitle(malMatch[1]);

  // MangaDex: /title/<uuid>/some-title
  const mdMatch = parsed.pathname.match(/\/title\/[^/]+\/([^/?#]+)/i);
  if (mdMatch) return slugToTitle(mdMatch[1]);

  // Generic: pick the last meaningful path segment.
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  // Skip trailing IDs / numeric segments — they're rarely useful as
  // search terms (e.g. Amazon `/dp/B0123ABCDE`). Walk from the end
  // until we find something with at least one letter.
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (/[a-zA-ZÀ-ɏ]/.test(seg)) {
      return slugToTitle(seg);
    }
  }
  return null;
}

/**
 * Turn a URL slug ("My-Hero-Academia" / "berserk_deluxe") into a
 * search-friendly title. URL-decoded, separators normalised to spaces,
 * collapsed whitespace.
 */
function slugToTitle(slug) {
  let decoded;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    decoded = slug;
  }
  return decoded
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
