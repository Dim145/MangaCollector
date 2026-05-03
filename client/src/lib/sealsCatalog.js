/**
 * Client-side catalog of seal codes. Keep the order and codes in sync with
 * `server/src/services/seals.rs::CATALOG` — order controls presentation,
 * codes are the contract with the backend.
 *
 * Each seal has:
 *   - `code`: stable identifier (matches server catalog + i18n key)
 *   - `kanji`: 1-2 chars brushed on the hanko stamp
 *   - `category`: grouping for the carnet layout
 *   - `tier`: 1..5, difficulty expressed as ink lineage —
 *       1 · 墨 sumi     (common ink, grey washi)
 *       2 · 印 hanko    (vermilion red, signature)
 *       3 · 萌葱 moegi  (jade green, cultivated)
 *       4 · 金 kin      (gold leaf, precious)
 *       5 · 漆黒 shikkoku (lacquer black with gold inlay, legendary)
 */
export const TIERS = {
  1: { name: "sumi", label: "墨" },
  2: { name: "hanko", label: "印" },
  3: { name: "moegi", label: "萌葱" },
  4: { name: "kin", label: "金" },
  5: { name: "shikkoku", label: "漆黒" },
};

export const SEAL_CATALOG = [
  // 入 Débuts — all "firsts" at tier 1 (sumi / common ink)
  { code: "first_volume", kanji: "初", category: "firsts", tier: 1 },
  { code: "first_series", kanji: "選", category: "firsts", tier: 1 },
  { code: "first_complete", kanji: "完", category: "firsts", tier: 1 },
  // 進 Progression — escalating tiers 2 → 5
  { code: "volumes_10", kanji: "十", category: "volumes", tier: 2 },
  { code: "volumes_100", kanji: "百", category: "volumes", tier: 3 },
  { code: "volumes_500", kanji: "伍", category: "volumes", tier: 4 },
  { code: "volumes_1000", kanji: "千", category: "volumes", tier: 5 },
  // 書 Étagère
  { code: "series_10", kanji: "架", category: "series", tier: 2 },
  { code: "series_50", kanji: "棚", category: "series", tier: 3 },
  // 完 Œuvres achevées
  { code: "complete_5", kanji: "終", category: "complete", tier: 2 },
  { code: "complete_25", kanji: "果", category: "complete", tier: 3 },
  { code: "complete_100", kanji: "極", category: "complete", tier: 4 },
  // 限 Édition collector
  { code: "first_collector", kanji: "限", category: "collector", tier: 1 },
  { code: "collector_10", kanji: "珍", category: "collector", tier: 2 },
  { code: "collector_100", kanji: "宝", category: "collector", tier: 4 },
  { code: "all_collector_1", kanji: "揃", category: "collector", tier: 3 },
  { code: "all_collector_10", kanji: "粋", category: "collector", tier: 4 },
  // 盒 Coffrets
  { code: "first_coffret", kanji: "盒", category: "coffret", tier: 1 },
  { code: "coffret_10", kanji: "箱", category: "coffret", tier: 2 },
  // 彩 Diversité
  { code: "genres_5", kanji: "彩", category: "diversity", tier: 2 },
  { code: "genres_15", kanji: "幅", category: "diversity", tier: 3 },
  // 年 Ancienneté
  { code: "anniversary_1", kanji: "年", category: "anniversary", tier: 2 },
  { code: "anniversary_5", kanji: "歴", category: "anniversary", tier: 5 },
  // 読 Lecture — orthogonal reading axis, parallel to volumes progression
  { code: "first_read", kanji: "読", category: "reading", tier: 1 },
  { code: "read_10", kanji: "十", category: "reading", tier: 2 },
  { code: "read_100", kanji: "百", category: "reading", tier: 3 },
  { code: "read_500", kanji: "伍", category: "reading", tier: 4 },
  { code: "read_1000", kanji: "千", category: "reading", tier: 5 },
  { code: "first_full_read", kanji: "破", category: "dokuha", tier: 2 },
  { code: "full_read_10", kanji: "精", category: "dokuha", tier: 3 },
  { code: "full_read_50", kanji: "究", category: "dokuha", tier: 5 },
  // 季節 Sceaux saisonniers — only grantable inside a specific
  // calendar window. The `season` object carries the window (1-12,
  // both ends inclusive) plus a single-kanji hint for the chip
  // overlay. `start > end` wraps year-end (winter Rintō).
  // Tier defaults to 4 (kin / gold leaf) — earnable but rare,
  // since the user has to stumble onto the right month.
  { code: "kisetsu_sakura",   kanji: "桜", category: "seasonal", tier: 4, season: { start: 4,  end: 5,  kanji: "春" } },
  { code: "kisetsu_tanabata", kanji: "祭", category: "seasonal", tier: 4, season: { start: 7,  end: 7,  kanji: "夏" } },
  { code: "kisetsu_tsukimi",  kanji: "月", category: "seasonal", tier: 4, season: { start: 9,  end: 10, kanji: "月" } },
  { code: "kisetsu_kouyou",   kanji: "紅", category: "seasonal", tier: 4, season: { start: 10, end: 11, kanji: "秋" } },
  { code: "kisetsu_rinto",    kanji: "凛", category: "seasonal", tier: 5, season: { start: 12, end: 2,  kanji: "冬" } },
];

export const SEAL_CATEGORIES = [
  { code: "firsts", kanji: "入" },
  { code: "volumes", kanji: "進" },
  { code: "series", kanji: "書" },
  { code: "complete", kanji: "完" },
  { code: "collector", kanji: "限" },
  { code: "coffret", kanji: "盒" },
  { code: "diversity", kanji: "彩" },
  { code: "anniversary", kanji: "年" },
  { code: "reading", kanji: "読" },
  { code: "dokuha", kanji: "破" },
  { code: "seasonal", kanji: "季" },
];

/**
 * 季節 · Helper — true when a seasonal seal's window covers the
 * supplied month (1-12). Returns false (i.e. "not currently
 * available") for non-seasonal seals so callers can drive a single
 * "active now" indicator across the catalog. Wrapping windows
 * (start > end) cover the year-end seam.
 */
export function isSealActiveInMonth(seal, month) {
  const w = seal?.season;
  if (!w) return false;
  if (w.start <= w.end) return month >= w.start && month <= w.end;
  return month >= w.start || month <= w.end;
}

/** Seals grouped by category, in catalog order. */
export const SEALS_BY_CATEGORY = SEAL_CATEGORIES.map((cat) => ({
  ...cat,
  seals: SEAL_CATALOG.filter((s) => s.category === cat.code),
}));

/** Lookup by code — O(1) for the renderer. */
export const SEAL_BY_CODE = new Map(SEAL_CATALOG.map((s) => [s.code, s]));
