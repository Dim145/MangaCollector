import { db } from "./db.js";
import axios from "@/utils/axios.js";

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
  // Clamp untrusted input length BEFORE running 9 regex patterns over
  // it. Today the caller is Google Books (trusted-shape strings), but
  // we also expose this from external code paths (Web Share Target
  // pre-fill heuristics could route here in the future); a paranoid
  // 500-char cap defuses any ReDoS class issue without truncating any
  // realistic manga title.
  const safeTitle =
    fullTitle.length > 500 ? fullTitle.slice(0, 500) : fullTitle;
  for (const pattern of VOL_PATTERNS) {
    const match = safeTitle.match(pattern);
    if (match) {
      const volume = parseInt(match[1], 10);
      if (Number.isNaN(volume)) continue;
      const title = safeTitle
        .replace(pattern, "")
        .trim()
        .replace(/[,:;\-–—]+$/, "")
        .trim();
      return { title: title || safeTitle, volume };
    }
  }
  return { title: safeTitle.trim(), volume: null };
}

/**
 * Validate an ISBN-10 / ISBN-13 checksum. Catches deeply malformed
 * inputs that would still pass the digit-count regex (e.g. all-9s,
 * scanner glitch returning a partially-decoded code). Used by
 * `normalizeISBN` to reject garbage before it hits the network.
 *
 * Returns `true` for valid checksums, `false` otherwise. Doesn't
 * throw — bad input simply means "not an ISBN".
 */
function isValidIsbnChecksum(digits) {
  if (digits.length === 10) {
    // Each digit i (0..8) is multiplied by (10 - i); the 10th digit
    // can be 0..9 OR 'X' (=10). Sum must be ≡ 0 (mod 11).
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(digits[i], 10) * (10 - i);
    const last = digits[9];
    sum += last === "X" || last === "x" ? 10 : parseInt(last, 10);
    return sum % 11 === 0;
  }
  if (digits.length === 13) {
    // Alternating weights of 1 and 3; sum must be ≡ 0 (mod 10).
    let sum = 0;
    for (let i = 0; i < 13; i++) {
      const d = parseInt(digits[i], 10);
      sum += i % 2 === 0 ? d : d * 3;
    }
    return sum % 10 === 0;
  }
  return false;
}

export function normalizeISBN(raw) {
  const clean = String(raw || "").replace(/[-\s]/g, "");
  if (!/^(\d{10}|\d{13}|\d{9}[Xx])$/.test(clean)) return null;
  // 印 · Reject inputs whose checksum is invalid. A scanner that
  // half-decoded a barcode can produce 13 plausible digits whose
  // overall code is meaningless — we'd burn a Google Books quota
  // call on each. Refusing them upfront keeps the rate-limit
  // budget for real codes only.
  if (!isValidIsbnChecksum(clean)) return null;
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
      `Google Books rate limit — retrying in ${remainS}s. Add an API key in Settings to avoid this.`,
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

  // 鍵 · `referrerPolicy: "no-referrer"` keeps the API key out of the
  // `Referer` header travelling to Google. The key is already in the
  // URL query string (Google's own contract — they support both this
  // and the `key=` query approach), so the Referer would otherwise
  // round-trip the same secret to any redirect target Google might
  // bounce us through. The cover-image elements separately set
  // `referrerPolicy="no-referrer"` on `<img>`; this aligns the JS
  // fetch with the same policy.
  const res = await fetch(`${GOOGLE_BOOKS}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    referrerPolicy: "no-referrer",
  });

  if (res.status === 429) {
    triggerCooldown();
    const err = new Error(
      "Google Books rate limit reached. Add an API key in Settings, or wait a bit before scanning more.",
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

  // Price — Google Books exposes it on `saleInfo`. `retailPrice` is what
  // they actually sell it for (after discounts); `listPrice` is the
  // publisher-declared MSRP. Prefer retail, fall back to list. Often
  // absent for manga, especially outside US/UK/JP markets.
  const sale = item.saleInfo || {};
  let price = null;
  const picked = sale.retailPrice ?? sale.listPrice;
  if (picked && typeof picked.amount === "number") {
    price = {
      amount: picked.amount,
      currency: picked.currencyCode,
      source: sale.retailPrice ? "retail" : "list",
    };
  }

  const result = {
    isbn,
    rawTitle: fullTitle,
    title,
    volume,
    authors: info.authors ?? [],
    publisher: info.publisher,
    // Best-effort guess at the edition variant — Google Books has no
    // structured field for it, so we read the raw title for marker
    // words. Non-matches stay null and the user fills them in later.
    edition: detectEditionFromTitle(fullTitle),
    pageCount: typeof info.pageCount === "number" ? info.pageCount : null,
    thumbnail:
      info.imageLinks?.extraLarge ??
      info.imageLinks?.large ??
      info.imageLinks?.thumbnail ??
      info.imageLinks?.smallThumbnail ??
      null,
    description: info.description,
    language: info.language,
    price,
  };

  await writeCached(isbn, result);
  return result;
}

/**
 * Sniff the edition variant out of a Google Books title. Returns a
 * canonical label drawn from the same vocabulary the manual edit form
 * exposes, or `null` when nothing matches.
 *
 * Order matters: more specific markers come first so "Perfect Edition"
 * isn't shadowed by a generic "edition" hit. Match is case-insensitive
 * and word-bounded enough to skip false positives ("Standardize").
 *
 * Conservative on purpose — it's better to leave the field blank than
 * to mis-tag a series; the user always has the final say in the edit
 * form. This is a best-effort prefill, not a classifier.
 */
function detectEditionFromTitle(rawTitle) {
  if (!rawTitle) return null;
  const t = rawTitle.toLowerCase();
  // [pattern, canonical label] — patterns are word-level so we don't
  // catch substrings (e.g. "starlight" wouldn't trip "ultimate").
  const RULES = [
    [/\bperfect\s+edition\b/i, "Perfect Edition"],
    [/\bultimate\s+edition\b/i, "Ultimate"],
    [/\bdeluxe(\s+edition)?\b/i, "Deluxe"],
    [/\bkanzenban\b/i, "Kanzenban"],
    [/\bbunkoban\b/i, "Pocket / Bunkoban"],
    [/\b(édition\s+collector|collector'?s?\s+edition)\b/i, "Anniversary"],
    [/\b(édition\s+anniversaire|anniversary\s+edition)\b/i, "Anniversary"],
    [/\b(édition\s+couleur|colou?r\s+edition)\b/i, "Colour edition"],
    [/\bédition\s+originale\b/i, "Original"],
    [/\b(double\s+edition|tomes?\s+doubles?)\b/i, "Double volumes"],
  ];
  for (const [re, label] of RULES) {
    if (re.test(t)) return label;
  }
  return null;
}

// Words that unambiguously mark a multi-volume pack on the product title.
// "Coffret" in FR, "box set" in EN, "intégrale" for complete editions, etc.
// Google Books never returns a structured `isCoffret` flag, so we fall back
// to title-text signals + volume-range extraction.
const COFFRET_KEYWORDS =
  /\b(box[\s-]?set|boxset|coffret|int[eé]grale|slipcase|complete\s+(?:series|set|collection))\b/i;

// "Vol. 1-13", "Tomes 1 à 5", "Volumes 1 to 3", "#1-3"
const COFFRET_RANGE =
  /(?:vol(?:umes?|s)?\.?|tomes?|books?|#)\s*(\d+)\s*(?:[-–—]|\s+(?:à|to)\s+)\s*(\d+)/i;

/**
 * Heuristic "is this a coffret / box-set ?" classifier over a Google Books
 * lookup result. Returns `{ isCoffret, volStart?, volEnd?, name? }`.
 *
 * Purely text-based — Google Books has no structured signal for box sets,
 * so we rely on keyword matching + volume-range extraction from the title.
 * The caller should surface a "this isn't actually a coffret" escape hatch
 * since false positives are possible (e.g. a single deluxe volume named
 * "Deluxe Edition, Volume 1").
 */
export function detectCoffret(book) {
  if (!book) return { isCoffret: false };
  const title = book.rawTitle ?? book.title ?? "";
  if (!title) return { isCoffret: false };

  const hasKeyword = COFFRET_KEYWORDS.test(title);
  const rangeMatch = title.match(COFFRET_RANGE);
  if (!hasKeyword && !rangeMatch) return { isCoffret: false };

  let volStart, volEnd;
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1], 10);
    const b = parseInt(rangeMatch[2], 10);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b >= a) {
      volStart = a;
      volEnd = b;
    }
  }
  return { isCoffret: true, volStart, volEnd, name: title };
}

/**
 * Search across MAL + MangaDex through our server's unified endpoint.
 * Returns a merged list where items carry a `source` marker ("mal", "mangadex"
 * or "both") and, when applicable, both `mal_id` and `mangadex_id`.
 *
 * Server applies the merge rule: MAL data wins for metadata, MangaDex wins
 * for the cover. See `server/src/services/external.rs`.
 */
export async function searchExternal(title) {
  if (!title?.trim()) return [];
  try {
    const { data } = await axios.get("/api/external/search", {
      params: { q: title },
    });
    return data?.results ?? [];
  } catch (err) {
    console.error("external search failed", err);
    return [];
  }
}
