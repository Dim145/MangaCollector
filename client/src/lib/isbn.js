import { db } from "./db.js";

/*
 * ISBN → manga resolution via Google Books.
 *
 * Rate-limit safety, top to bottom:
 *   1. Dexie cache (30 days) — same ISBN never re-queried
 *   2. Negative cache (10 min for "no match", longer for 429)
 *   3. Client-side throttle — min 600 ms between two Google Books calls
 *   4. Adaptive cooldown — after a 429, back off for 60 s (exponential on repeat)
 *   5. Optional API key (localStorage) — bumps per-IP anonymous quota to the
 *      per-project quota of the Google Cloud project owning the key
 *
 * Caller sees any quota problem as a thrown Error with a user-friendly
 * message, so the scanner UI can surface it cleanly.
 */

const GOOGLE_BOOKS = "https://www.googleapis.com/books/v1/volumes";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days for positive hits
const NO_MATCH_TTL_MS = 10 * 60 * 1000; // 10 min for "no match"
const MIN_GAP_MS = 600;

const API_KEY_STORAGE = "mc:google-books-key";

let lastCallAt = 0;
let cooldownUntil = 0;
let consecutive429 = 0;

/* ─── API key helpers (localStorage) ─────────────────────────────── */

export function getApiKey() {
  try {
    return localStorage.getItem(API_KEY_STORAGE) || null;
  } catch {
    return null;
  }
}

export function setApiKey(key) {
  try {
    const trimmed = (key || "").trim();
    if (trimmed) localStorage.setItem(API_KEY_STORAGE, trimmed);
    else localStorage.removeItem(API_KEY_STORAGE);
    // A new key resets the per-IP cooldown: the request now carries
    // identity, so the anonymous throttle no longer applies.
    cooldownUntil = 0;
    consecutive429 = 0;
  } catch {
    /* ignore */
  }
}

export function getCooldownRemainingMs() {
  return Math.max(0, cooldownUntil - Date.now());
}

/* ─── Helpers ────────────────────────────────────────────────────── */

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

export function parseTitleVolume(fullTitle) {
  if (!fullTitle) return { title: "", volume: null };
  for (const pattern of VOL_PATTERNS) {
    const match = fullTitle.match(pattern);
    if (match) {
      const volume = parseInt(match[1], 10);
      if (Number.isNaN(volume)) continue;
      const title = fullTitle
        .replace(pattern, "")
        .trim()
        .replace(/[,:;\-–—]+$/, "")
        .trim();
      return { title: title || fullTitle, volume };
    }
  }
  return { title: fullTitle.trim(), volume: null };
}

export function normalizeISBN(raw) {
  const clean = String(raw || "").replace(/[-\s]/g, "");
  if (!/^(\d{10}|\d{13})$/.test(clean)) return null;
  return clean;
}

async function readCached(isbn) {
  try {
    const row = await db.isbnCache.get(isbn);
    if (!row) return undefined; // not in cache at all
    const ttl = row.result == null ? NO_MATCH_TTL_MS : CACHE_TTL_MS;
    if (Date.now() - row.ts > ttl) return undefined;
    return row.result;
  } catch {
    return undefined;
  }
}

async function writeCached(isbn, result) {
  try {
    await db.isbnCache.put({ isbn, result, ts: Date.now() });
  } catch {
    /* ignore quota / storage errors */
  }
}

async function throttle() {
  const now = Date.now();

  if (now < cooldownUntil) {
    const remainS = Math.ceil((cooldownUntil - now) / 1000);
    const err = new Error(
      `Google Books rate limit — retrying in ${remainS}s. Add an API key in Settings to avoid this.`
    );
    err.code = "RATE_LIMITED";
    throw err;
  }

  const wait = Math.max(0, lastCallAt + MIN_GAP_MS - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

function triggerCooldown() {
  consecutive429 += 1;
  // 60s × 2^(n-1), capped at 10 min
  const seconds = Math.min(60 * 2 ** (consecutive429 - 1), 600);
  cooldownUntil = Date.now() + seconds * 1000;
}

function clearCooldown() {
  consecutive429 = 0;
  cooldownUntil = 0;
}

/* ─── Public API ─────────────────────────────────────────────────── */

export async function lookupISBN(rawIsbn) {
  const isbn = normalizeISBN(rawIsbn);
  if (!isbn) throw new Error("Invalid ISBN");

  const cached = await readCached(isbn);
  if (cached !== undefined) return cached;

  await throttle();

  const apiKey = getApiKey();
  const params = new URLSearchParams({
    q: `isbn:${isbn}`,
    maxResults: "1",
  });
  if (apiKey) params.set("key", apiKey);

  const res = await fetch(`${GOOGLE_BOOKS}?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });

  if (res.status === 429) {
    triggerCooldown();
    const err = new Error(
      "Google Books rate limit reached. Add an API key in Settings, or wait a bit before scanning more."
    );
    err.code = "RATE_LIMITED";
    throw err;
  }

  if (!res.ok) {
    throw new Error(`Google Books error: ${res.status}`);
  }

  clearCooldown();

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
