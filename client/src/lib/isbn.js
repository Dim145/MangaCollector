import { db } from "./db.js";
import axios from "@/utils/axios.js";

/*
 * ISBN → manga resolution. Server first (shared cache, four catalogues),
 * direct catalogues when the server cannot be reached — see `lookupISBN`.
 *
 * Rate-limit safety on the direct Google Books path, top to bottom:
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
// Hard ceiling on a single scan lookup. Neither the Google Books `fetch`
// nor the axios instance sets a timeout, so a black-holed request (proxy
// stall, captive portal) would otherwise hang the scanner in its
// "looking-up" phase forever. Bounding it here turns a hang into a
// rejection the scan flow routes to its transient/retry UI.
const SCAN_LOOKUP_TIMEOUT_MS = 12_000;

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
  // `\b` before the `t` is load-bearing: without it this pattern
  // matches the trailing "t" of any word followed by a number, so
  // "Berserk Part 12" was stripped to "Berserk Par" before the
  // dedicated `part` pattern further down ever got a chance to run.
  /,?\s*\bt\.?\s*(\d+)\b/i,
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

/**
 * The 13-digit form of a valid ISBN-10/13 (what an EAN-13 scan yields and
 * what the server stores), or `null`. Use it wherever two ISBNs are
 * compared; `normalizeISBN` only validates and strips separators.
 */
export function isbn13Of(raw) {
  const clean = normalizeISBN(raw);
  if (!clean) return null;
  if (clean.length === 13) return clean;
  const base = `978${clean.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return `${base}${(10 - (sum % 10)) % 10}`;
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

/**
 * Resolve a scanned ISBN to a book.
 *
 *   1. Dexie cache — same ISBN never re-queried on this device
 *   2. The server (`GET /api/user/isbn/{isbn}`) — one shared cache for
 *      the whole instance and a chain of catalogues (Google Books →
 *      Open Library → BnF → openBD), see `services/isbn_resolver.rs`
 *   3. When the server itself is unreachable (self-hosted box asleep,
 *      captive network, outage) the browser asks the CORS-friendly
 *      catalogues directly — Google Books, Open Library, openBD — so a
 *      scan still names the tome. BnF has no CORS and stays server-only.
 *
 * A server answer of "nobody knows this barcode" is final (no direct
 * retry); only a transport failure falls through. Quota problems on the
 * direct Google path still surface as `RATE_LIMITED` when no other
 * catalogue rescued the lookup.
 */
export async function lookupISBN(rawIsbn) {
  const isbn = normalizeISBN(rawIsbn);
  if (!isbn) throw new Error("Invalid ISBN");
  const cached = await readCached(isbn);
  if (cached !== undefined) return cached;

  const viaServer = await lookupViaServer(isbn);
  if (viaServer !== undefined) {
    await writeCached(isbn, viaServer);
    return viaServer;
  }

  const direct = await lookupDirect(isbn);
  await writeCached(isbn, direct);
  return direct;
}

const SERVER_LOOKUP_TIMEOUT_MS = 10_000;

/**
 * `undefined` = the server could not be reached (fall back), `null` =
 * it answered and knows nothing, an object = the book.
 */
async function lookupViaServer(isbn) {
  try {
    const { data } = await axios.get(`/api/user/isbn/${isbn}`, {
      timeout: SERVER_LOOKUP_TIMEOUT_MS,
    });
    if (!data?.found || !data.book) return null;
    return fromCatalogueBook(data.book, isbn);
  } catch (err) {
    if (err?.response?.status === 400) {
      throw new Error("Invalid ISBN", { cause: err });
    }
    // No response (network, timeout), a 5xx, or a 401 on a box that
    // lost its session: none of these say anything about the book.
    return undefined;
  }
}

/** Direct chain, used only when the server is unreachable. */
async function lookupDirect(isbn) {
  let rateLimited = null;
  try {
    const google = await lookupGoogleDirect(isbn);
    if (google) return google;
  } catch (err) {
    if (err?.code === "RATE_LIMITED") rateLimited = err;
    else throw err;
  }
  const openLibrary = await lookupOpenLibraryDirect(isbn).catch(() => null);
  if (openLibrary) return openLibrary;
  const openBd = await lookupOpenBdDirect(isbn).catch(() => null);
  if (openBd) return openBd;
  if (rateLimited) throw rateLimited;
  return null;
}

/**
 * Map a catalogue book — the server's `IsbnBook` or a direct Open
 * Library / openBD hit shaped the same way — onto the result the scan
 * flow consumes (series title + volume parsed out of the raw title,
 * edition sniffed, cover, price).
 */
function fromCatalogueBook(book, isbn) {
  const fullTitle = [book.title, book.subtitle].filter(Boolean).join(" ");
  const { title, volume } = parseTitleVolume(fullTitle);
  return {
    isbn,
    rawTitle: fullTitle,
    title,
    volume,
    authors: Array.isArray(book.authors) ? book.authors : [],
    publisher: book.publisher ?? undefined,
    edition: detectEditionFromTitle(fullTitle),
    pageCount: typeof book.page_count === "number" ? book.page_count : null,
    thumbnail: book.cover ?? null,
    description: book.description ?? undefined,
    language: book.language ?? undefined,
    price:
      book.price && typeof book.price.amount === "number"
        ? {
            amount: book.price.amount,
            currency: book.price.currency,
            source: book.source ?? "catalogue",
          }
        : null,
    source: book.source ?? "catalogue",
  };
}

function withTimeout(ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, done: () => clearTimeout(timer) };
}

async function lookupGoogleDirect(isbn) {
  await throttle();
  const apiKey = getApiKey();
  const params = new URLSearchParams({
    q: `isbn:${isbn}`,
    maxResults: "1",
  });
  if (apiKey) params.set("key", apiKey);
  // 鍵 · `referrerPolicy: "no-referrer"` keeps the API key out of the
  // `Referer` header travelling to Google. The key is already in the
  // URL query string (Google's own contract), so the Referer would
  // otherwise round-trip the same secret to any redirect target.
  const t = withTimeout(SCAN_LOOKUP_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${GOOGLE_BOOKS}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      referrerPolicy: "no-referrer",
      signal: t.signal,
    });
  } finally {
    t.done();
  }
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
  if (!item) return null;
  const info = item.volumeInfo || {};
  const sale = item.saleInfo || {};
  const picked = sale.retailPrice ?? sale.listPrice;
  return fromCatalogueBook(
    {
      title: info.title,
      subtitle: info.subtitle,
      authors: info.authors ?? [],
      publisher: info.publisher,
      page_count: typeof info.pageCount === "number" ? info.pageCount : null,
      cover:
        info.imageLinks?.extraLarge ??
        info.imageLinks?.large ??
        info.imageLinks?.thumbnail ??
        info.imageLinks?.smallThumbnail ??
        null,
      description: info.description,
      language: info.language,
      price:
        picked && typeof picked.amount === "number"
          ? { amount: picked.amount, currency: picked.currencyCode }
          : null,
      source: "google_books",
    },
    isbn,
  );
}

const OPEN_LIBRARY_SEARCH = "https://openlibrary.org/search.json";
const OPENBD_GET = "https://api.openbd.jp/v1/get";
const DIRECT_TIMEOUT_MS = 8_000;

async function lookupOpenLibraryDirect(isbn) {
  const params = new URLSearchParams({
    isbn,
    fields:
      "title,subtitle,author_name,publisher,first_publish_year,number_of_pages_median,language,cover_i",
    limit: "1",
  });
  const t = withTimeout(DIRECT_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${OPEN_LIBRARY_SEARCH}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: t.signal,
    });
  } finally {
    t.done();
  }
  if (!res.ok) return null;
  const doc = (await res.json())?.docs?.[0];
  if (!doc?.title) return null;
  return fromCatalogueBook(
    {
      title: doc.title,
      subtitle: doc.subtitle,
      authors: doc.author_name ?? [],
      publisher: doc.publisher?.[0],
      page_count: doc.number_of_pages_median ?? null,
      language: doc.language?.[0],
      cover: doc.cover_i
        ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
        : null,
      source: "open_library",
    },
    isbn,
  );
}

async function lookupOpenBdDirect(isbn) {
  const t = withTimeout(DIRECT_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${OPENBD_GET}?isbn=${encodeURIComponent(isbn)}`, {
      headers: { Accept: "application/json" },
      signal: t.signal,
    });
  } finally {
    t.done();
  }
  if (!res.ok) return null;
  const summary = (await res.json())?.[0]?.summary;
  if (!summary?.title) return null;
  const authors = String(summary.author ?? "")
    .split(/[／/]/)
    .map((s) => s.trim())
    .filter((s) => s && !["著", "作", "原作", "画"].includes(s));
  return fromCatalogueBook(
    {
      title: summary.title,
      subtitle: summary.volume,
      authors,
      publisher: summary.publisher,
      language: "ja",
      cover: summary.cover
        ? String(summary.cover).replace(/^http:\/\//, "https://")
        : null,
      source: "openbd",
    },
    isbn,
  );
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
 *
 * 失 · Real network / server failures (incl. 502 when both upstreams are
 * down) are RETHROWN so the scan flow can route them through the
 * `transient` retry UI. An empty result `[]` therefore unambiguously
 * means "the search ran, nothing matched".
 */
export async function searchExternal(title) {
  if (!title?.trim()) return [];
  const { data } = await axios.get("/api/external/search", {
    params: { q: title },
    timeout: SCAN_LOOKUP_TIMEOUT_MS,
  });
  return data?.results ?? [];
}
