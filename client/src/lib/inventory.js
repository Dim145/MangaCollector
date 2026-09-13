/**
 * 棚卸 · Inventory (stock-taking) — pure state helpers.
 *
 * A session names a scope (the whole shelf, one series, one place),
 * expects every owned tome in it, and ticks tomes off as their barcode
 * is scanned or as the user taps them. Everything is derived from the
 * cached volumes, so a count works with no network at all; the session
 * lives in localStorage so a locked phone does not lose it.
 */
import { isbn13Of } from "./isbn.js";
import { findLocalByIsbn } from "./scanLookup.js";
import { normalizeLocationName } from "./locations.js";

export const INVENTORY_STORAGE_KEY = "mc.inventory.v1";
const BOM = String.fromCharCode(0xfeff);

function ownedInScope(volumes, scope) {
  const rows = (Array.isArray(volumes) ? volumes : []).filter((v) => v?.owned);
  if (scope?.kind === "series")
    return rows.filter((v) => v.mal_id === scope.mal_id);
  if (scope?.kind === "place") {
    const name = normalizeLocationName(scope.name);
    return rows.filter((v) => normalizeLocationName(v.location) === name);
  }
  return rows;
}

/** A fresh session for `scope` (`{kind:"all"} | {kind:"series", mal_id} | {kind:"place", name}`). */
export function buildSession(scope, volumes, now = new Date()) {
  const expected = ownedInScope(volumes, scope)
    .sort((a, b) => a.mal_id - b.mal_id || a.vol_num - b.vol_num)
    .map((v) => v.id);
  return {
    scope: scope ?? { kind: "all" },
    expected,
    seen: {},
    unknown: [],
    outside: [],
    startedAt: now.toISOString(),
    finishedAt: null,
  };
}

/**
 * Apply one scanned barcode. Outcomes: `present` (ticked now), `repeat`
 * (already ticked), `outside` (on the shelf but not in this scope),
 * `unknown` (no tome carries that ISBN), `invalid`.
 */
export function applyScan(
  session,
  rawIsbn,
  volumes,
  library,
  now = new Date(),
) {
  const isbn = isbn13Of(rawIsbn);
  if (!isbn) return { session, outcome: "invalid", isbn: null };
  const hit = findLocalByIsbn(volumes, library, isbn);
  if (!hit) {
    const unknown = session.unknown.includes(isbn)
      ? session.unknown
      : [...session.unknown, isbn];
    return { session: { ...session, unknown }, outcome: "unknown", isbn };
  }
  const { volume, series } = hit;
  if (!session.expected.includes(volume.id)) {
    const already = session.outside.some((o) => o.id === volume.id);
    const outside = already
      ? session.outside
      : [...session.outside, { id: volume.id, isbn }];
    return {
      session: { ...session, outside },
      outcome: "outside",
      isbn,
      volume,
      series,
    };
  }
  if (session.seen[volume.id])
    return { session, outcome: "repeat", isbn, volume, series };
  return {
    session: {
      ...session,
      seen: { ...session.seen, [volume.id]: now.toISOString() },
    },
    outcome: "present",
    isbn,
    volume,
    series,
  };
}

/** Tap a row: tick or untick by hand (tomes without a barcode). */
export function toggleSeen(session, id, now = new Date()) {
  const seen = { ...session.seen };
  if (seen[id]) delete seen[id];
  else seen[id] = now.toISOString();
  return { ...session, seen };
}

/** What the count says so far. Missing tomes that are out on loan are set apart. */
export function summarize(session, volumes, library) {
  const byId = new Map(
    (Array.isArray(volumes) ? volumes : []).map((v) => [v.id, v]),
  );
  const series = new Map(
    (Array.isArray(library) ? library : []).map((s) => [s.mal_id, s]),
  );
  const decorate = (id) => {
    const v = byId.get(id);
    return v ? { ...v, series_name: series.get(v.mal_id)?.name ?? "" } : null;
  };
  const present = [];
  const missing = [];
  const lent = [];
  for (const id of session.expected) {
    const v = decorate(id);
    if (!v) continue;
    if (session.seen[id]) present.push(v);
    else if (v.loaned_to) lent.push(v);
    else missing.push(v);
  }
  const sortRows = (rows) =>
    rows.sort(
      (a, b) =>
        a.series_name.localeCompare(b.series_name) || a.vol_num - b.vol_num,
    );
  return {
    total: session.expected.length,
    present: sortRows(present),
    missing: sortRows(missing),
    lent: sortRows(lent),
    unknown: session.unknown,
    outside: session.outside.map((o) => decorate(o.id)).filter(Boolean),
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The missing list (loans included, flagged) as CSV — what to go looking for. */
export function missingCsv(summary) {
  const lines = [`${BOM}series,volume,place,lent_to`];
  for (const v of [...summary.missing, ...summary.lent]) {
    lines.push(
      [v.series_name, v.vol_num, v.location ?? "", v.loaned_to ?? ""]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export function loadSession(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(INVENTORY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.expected) && parsed.seen ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(session, storage = globalThis.localStorage) {
  try {
    if (session)
      storage?.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(session));
    else storage?.removeItem(INVENTORY_STORAGE_KEY);
  } catch {
    /* storage may be unavailable — the count still works in memory */
  }
}
