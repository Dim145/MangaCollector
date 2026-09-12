/*
 * 並 · Library sort — pure helpers shared by the Dashboard and its
 * SortMenu.
 *
 * The Dexie read the dashboard is built on (`db.library.toArray()`)
 * comes back in primary-key order, i.e. by mal_id: custom series first
 * (negative ids), then MAL series in whatever order MyAnimeList happened
 * to number them. Nobody thinks in that order, so the grid gets an
 * explicit sort, title first by default.
 *
 * Every key has a natural direction — newest first for dates, most
 * first for counts, A→Z for text — and the user can flip it. Series
 * that have no value for the chosen key (no author, no published
 * total, nothing announced) always go last, whichever the direction:
 * a gap is not "the smallest value", it is the absence of one.
 * `sortLibrary` is stable, ties fall back to the title, and the input
 * array is never mutated.
 */

export const SORT_KEYS = [
  { id: "title", glyph: "題", dir: "asc" },
  { id: "added", glyph: "新", dir: "desc" },
  { id: "updated", glyph: "更", dir: "desc" },
  { id: "progress", glyph: "進", dir: "desc" },
  { id: "missing", glyph: "欠", dir: "desc" },
  { id: "owned", glyph: "所", dir: "desc" },
  { id: "author", glyph: "作", dir: "asc" },
  { id: "upcoming", glyph: "来", dir: "asc" },
];

export const DEFAULT_SORT = { key: "title", dir: "asc" };

/** Natural direction for a key — what the menu selects on first pick. */
export function defaultDirFor(key) {
  return SORT_KEYS.find((k) => k.id === key)?.dir ?? "asc";
}

/** Anything persisted (or nothing) → a valid `{ key, dir }`. */
export function normalizeSort(raw) {
  const def = SORT_KEYS.find((k) => k.id === raw?.key);
  if (!def) return { ...DEFAULT_SORT };
  const dir = raw.dir === "asc" || raw.dir === "desc" ? raw.dir : def.dir;
  return { key: def.id, dir };
}

function ts(value) {
  if (!value) return 0;
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : 0;
}

// One collator per UI language. `numeric` keeps "Vol 2" ahead of
// "Vol 10", `base` sensitivity folds accents and case, and
// `ignorePunctuation` files "【Oshi no Ko】" under O instead of parking
// every bracketed or quoted title at the top of the shelf.
const COLLATOR_OPTS = {
  sensitivity: "base",
  numeric: true,
  ignorePunctuation: true,
};
const collators = new Map();
function collatorFor(locale) {
  const key = locale || "default";
  let c = collators.get(key);
  if (!c) {
    try {
      c = new Intl.Collator(locale || undefined, COLLATOR_OPTS);
    } catch {
      c = new Intl.Collator(undefined, COLLATOR_OPTS);
    }
    collators.set(key, c);
  }
  return c;
}

/**
 * The value a series sorts on for `key`. Text keys yield `{ text }`,
 * numeric ones `{ num }`; an empty string / `null` means "no value".
 */
function metric(key, m, ctx) {
  switch (key) {
    case "author":
      return { text: (m.author?.name ?? "").trim() };
    case "added":
      return { num: ts(m.created_on) || null };
    case "updated":
      return { num: ts(m.modified_on) || null };
    case "progress": {
      const total = m.volumes ?? 0;
      return { num: total > 0 ? (m.volumes_owned ?? 0) / total : null };
    }
    case "missing": {
      const total = m.volumes ?? 0;
      return {
        num: total > 0 ? Math.max(0, total - (m.volumes_owned ?? 0)) : null,
      };
    }
    case "owned":
      return { num: m.volumes_owned ?? 0 };
    case "upcoming": {
      const next = ctx.nextUpcomingByMal?.get(m.mal_id);
      const when = next?.release_date_ms ?? ts(next?.release_date);
      return { num: when > 0 ? when : null };
    }
    case "title":
    default:
      return { text: (m.name ?? "").trim() };
  }
}

const isGap = (v) => ("text" in v ? v.text === "" : v.num == null);

/**
 * Sort a library list. `ctx.locale` picks the collation, and
 * `ctx.nextUpcomingByMal` (Map<mal_id, { release_date_ms }>) feeds the
 * "upcoming" key — the Dashboard already derives it for the cards.
 */
export function sortLibrary(list, sort, ctx = {}) {
  const { key, dir } = normalizeSort(sort);
  const sign = dir === "desc" ? -1 : 1;
  const collator = collatorFor(ctx.locale);
  const rows = (list ?? []).map((m, i) => ({
    m,
    i,
    v: metric(key, m, ctx),
    title: (m.name ?? "").trim(),
  }));
  rows.sort((a, b) => {
    const gapA = isGap(a.v);
    const gapB = isGap(b.v);
    if (gapA !== gapB) return gapA ? 1 : -1;
    let c = 0;
    if (!gapA) {
      c =
        "text" in a.v
          ? collator.compare(a.v.text, b.v.text)
          : a.v.num - b.v.num;
    }
    if (c !== 0) return sign * c;
    return collator.compare(a.title, b.title) || a.i - b.i;
  });
  return rows.map((r) => r.m);
}
