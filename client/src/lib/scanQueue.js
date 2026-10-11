import { findLocalByIsbn } from "./scanLookup.js";
import { foldForSearch } from "./upcomingPicker.js";
import { isbn13Of } from "./isbn.js";

/*
 * 列 · A batch of barcodes scanned in a row, reviewed at the end.
 *
 * The one-by-one scanner stops at every book to show it. Unpacking a
 * delivery or going along a shelf, a reader wants the other rhythm —
 * beep, next, beep, next — and to decide afterwards (the two modes CLZ
 * offers). Each barcode is classified the moment it is read, from the
 * device cache alone:
 *
 *   owned    — a copy on the shelf carries it, already owned
 *   missing  — a tome on the shelf carries it, not owned yet
 *   upcoming — an announced tome carries it and its date is still
 *              ahead: the server keeps such a row unowned until the day
 *              (`coerce_upcoming_flags`), so it is shown, never offered
 *   unknown  — no tome carries it; the catalogues are asked in the
 *              background, and when the book they describe belongs to a
 *              series of the library, by title and volume number, it
 *              becomes `owned` or `missing` too ("matched": by catalogue)
 *
 * Pure: the page holds the list, these functions only answer.
 */

/** A tome's standing: owned, announced with its date ahead, or missing. */
export function standingOf(volume, now = Date.now()) {
  if (volume?.owned) return "owned";
  const date = volume?.release_date ? new Date(volume.release_date).getTime() : NaN;
  return Number.isFinite(date) && date > now ? "upcoming" : "missing";
}

/** Where a freshly read barcode stands on the shelf. */
export function classifyScan(rawIsbn, volumes, library, now = Date.now()) {
  const isbn = isbn13Of(rawIsbn);
  if (!isbn) return null;
  const hit = findLocalByIsbn(volumes, library, isbn);
  if (!hit) return { isbn, kind: "unknown", volume: null, series: null, book: null, matched: null };
  return {
    isbn,
    kind: standingOf(hit.volume, now),
    volume: hit.volume,
    series: hit.series,
    book: null,
    matched: hit.matchedOn,
  };
}

/**
 * The library series a catalogue title names, or `null` when none or
 * several could be meant. Titles are compared folded (case, accents):
 * equal, or one starting with the other when the shorter is at least
 * four characters — "One Piece" finds "One Piece (Édition originale)",
 * "Ab" finds nothing.
 */
export function matchSeriesByTitle(library, title) {
  const needle = foldForSearch(title);
  if (!needle) return null;
  const rows = (library ?? []).filter((m) => m?.name);
  const exact = rows.filter((m) => foldForSearch(m.name) === needle);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  if (needle.length < 4) return null;
  const close = rows.filter((m) => {
    const name = foldForSearch(m.name);
    return name.length >= 4 && (name.startsWith(needle) || needle.startsWith(name));
  });
  return close.length === 1 ? close[0] : null;
}

/**
 * An `unknown` item once the catalogues answered: the book is kept, and
 * when it names a library series and a volume number whose tome exists,
 * the item takes that tome's standing.
 */
export function resolveWithBook(item, book, volumes, library, now = Date.now()) {
  if (!item || item.kind !== "unknown") return item;
  const next = { ...item, book: book ?? null };
  const volNum = Number(book?.volume);
  if (!book?.title || !Number.isInteger(volNum) || volNum < 1) return next;
  const series = matchSeriesByTitle(library, book.title);
  if (!series) return next;
  const volume = (volumes ?? []).find(
    (v) => v?.mal_id === series.mal_id && v.vol_num === volNum,
  );
  if (!volume) return next;
  return {
    ...next,
    kind: standingOf(volume, now),
    volume,
    series,
    matched: "catalogue",
  };
}

/** Counts by standing, for the scanner's status line and the review. */
export function queueSummary(items) {
  const out = { total: 0, owned: 0, missing: 0, upcoming: 0, unknown: 0 };
  for (const item of items ?? []) {
    out.total += 1;
    out[item.kind] = (out[item.kind] ?? 0) + 1;
  }
  return out;
}

// ── Kept for the session, so the add flow can be visited and returned from.

const STORAGE_KEY = "mc:scan-queue";

/** The barcodes (and what the catalogues said of them), not the derived standing. */
export function saveQueue(items) {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify((items ?? []).map((i) => ({ isbn: i.isbn, book: i.book ?? null }))),
    );
  } catch {
    /* private mode — the batch lives as long as the page */
  }
}

/** Re-classified against today's shelf: a tome added meanwhile moves group. */
export function loadQueue(volumes, library) {
  try {
    const raw = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const entry of raw) {
      const item = classifyScan(entry?.isbn, volumes, library);
      if (!item || out.some((i) => i.isbn === item.isbn)) continue;
      out.push(entry?.book ? resolveWithBook(item, entry.book, volumes, library) : item);
    }
    return out;
  } catch {
    return [];
  }
}

export function clearQueue() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing kept */
  }
}
