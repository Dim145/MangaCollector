import { db } from "./db.js";

/*
 * ISBN → manga resolution.
 *
 * Takes a raw EAN-13 barcode value, asks Google Books for the title, then
 * tries to tease out "series + volume number" with a pile of regexes
 * covering EN / FR / JP patterns most manga publishers use.
 *
 * The caller then passes `title` to Jikan for the real MAL match — this
 * module is just about turning a number into words.
 *
 * Results are cached in Dexie for 30 days (ISBNs don't move).
 */

const GOOGLE_BOOKS = "https://www.googleapis.com/books/v1/volumes";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Ordered from most-specific to most-generic. First match wins.
const VOL_PATTERNS = [
  /,?\s*vol(?:ume|\.)?\s*(\d+)\b/i,
  /,?\s*tome\s*(\d+)\b/i,
  /,?\s*t\.?\s*(\d+)\b/i,
  /,?\s*book\s*(\d+)\b/i,
  /,?\s*part\s*(\d+)\b/i,
  /\s*第\s*(\d+)\s*巻/,
  /\s*(\d+)\s*巻/,
  /,?\s*#\s*(\d+)\b/,
  /\s+(\d+)\s*$/,
];

/**
 * Split a full book title into series name + volume number.
 * Returns `{ title, volume }` — volume is `null` if none detected.
 */
export function parseTitleVolume(fullTitle) {
  if (!fullTitle) return { title: "", volume: null };
  for (const pattern of VOL_PATTERNS) {
    const match = fullTitle.match(pattern);
    if (match) {
      const volume = parseInt(match[1], 10);
      if (Number.isNaN(volume)) continue;
      const title = fullTitle.replace(pattern, "").trim().replace(/[,:;\-–—]+$/, "").trim();
      return { title: title || fullTitle, volume };
    }
  }
  return { title: fullTitle.trim(), volume: null };
}

/** Strip hyphens/spaces and validate length. */
export function normalizeISBN(raw) {
  const clean = String(raw || "").replace(/[-\s]/g, "");
  if (!/^(\d{10}|\d{13})$/.test(clean)) return null;
  return clean;
}

async function readCached(isbn) {
  try {
    const row = await db.isbnCache.get(isbn);
    if (!row) return null;
    if (Date.now() - row.ts > CACHE_TTL_MS) return null;
    return row.result;
  } catch {
    return null;
  }
}

async function writeCached(isbn, result) {
  try {
    await db.isbnCache.put({ isbn, result, ts: Date.now() });
  } catch {
    /* ignore quota / storage errors */
  }
}

/**
 * Resolve an ISBN to a manga-shaped record.
 *
 * Return shape on success:
 *   {
 *     isbn, rawTitle,
 *     title,      // series name, volume stripped
 *     volume,     // number or null
 *     authors: string[],
 *     publisher, thumbnail, description,
 *     language,   // "en", "fr", "ja"…
 *   }
 *
 * Returns `null` when Google Books has no match.
 */
export async function lookupISBN(rawIsbn) {
  const isbn = normalizeISBN(rawIsbn);
  if (!isbn) throw new Error("Invalid ISBN");

  const cached = await readCached(isbn);
  if (cached !== null) return cached;

  const res = await fetch(
    `${GOOGLE_BOOKS}?q=isbn:${isbn}&maxResults=1`,
    { headers: { Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`Google Books error: ${res.status}`);

  const data = await res.json();
  const item = data.items?.[0];
  if (!item) {
    await writeCached(isbn, null);
    return null;
  }

  const info = item.volumeInfo || {};
  const fullTitle = [info.title, info.subtitle].filter(Boolean).join(" ");
  const { title, volume } = parseTitleVolume(fullTitle);

  const result = {
    isbn,
    rawTitle: fullTitle,
    title,
    volume,
    authors: info.authors ?? [],
    publisher: info.publisher,
    thumbnail:
      info.imageLinks?.extraLarge ??
      info.imageLinks?.large ??
      info.imageLinks?.thumbnail ??
      info.imageLinks?.smallThumbnail ??
      null,
    description: info.description,
    language: info.language,
  };

  await writeCached(isbn, result);
  return result;
}

/**
 * Search Jikan (MAL) for the best series matches given a title.
 * Returns up to `limit` manga candidates.
 */
export async function searchMangaOnMal(title, limit = 5) {
  if (!title?.trim()) return [];
  const res = await fetch(
    `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(title)}&limit=${limit}`,
    { headers: { Accept: "application/json" } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.data ?? [];
}
