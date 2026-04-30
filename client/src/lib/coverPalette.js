/*
 * Cover image LQIP — deterministic placeholder colors.
 *
 * Picks a stable background color per series so the cover slot fills
 * with a Shōjo-Noir-coherent tint while the actual cover image is
 * being fetched. Replaces the previous "blank ink-2 → image pop"
 * transition with a "tinted swatch → image" cross-fade.
 *
 * Why deterministic instead of dominant-color extraction:
 *   - No CORS surface (canvas `getImageData` taints on cross-origin
 *     images without explicit `Access-Control-Allow-Origin: *`,
 *     which MAL / MangaDex don't reliably set)
 *   - No async cold-start (the color is available the first frame
 *     the card mounts; dominant-extraction would need a first-load
 *     to compute)
 *   - No Dexie cache table to maintain
 *   - Same color across reloads / devices for a given series
 *
 * The trade-off is the color isn't *from* the cover — it's a swatch
 * keyed on the series id. That's fine: the LQIP's job is to fill
 * empty space with something coherent, not to be photo-accurate.
 *
 * Palette: 8 muted tones drawn from the project's design tokens
 * (hanko / moegi / gold / sakura / ink) at low saturation so they
 * read as "background while loading" not "competing accent".
 */

// 8 swatches — power of 2 keeps the modulo bias-free for any int input.
//
// Deep, low-luminance tones (RGB-sum ~80) so the swatch reads as a
// settled "card waiting for its cover" rather than a competing accent.
// The cards mount at full opacity now, so the LQIP doesn't have to
// fight a fade-up — a dark, saturated tint sits comfortably under
// the bottom-gradient overlay and still ghosts through the top
// third of the cover slot.
const PALETTE = [
  "rgb(41, 19, 24)",   // hanko deep
  "rgb(27, 34, 21)",   // moegi ink
  "rgb(38, 30, 16)",   // gold deep
  "rgb(40, 22, 32)",   // sakura ink
  "rgb(22, 25, 35)",   // shikkoku
  "rgb(34, 28, 21)",   // sumi warm
  "rgb(23, 35, 29)",   // moss
  "rgb(39, 21, 29)",   // wine
];

/**
 * Stable LQIP color for a series. Returns one of the palette swatches
 * deterministically based on `mal_id` (positive or negative — custom
 * entries with negative ids work the same).
 *
 * Returns the same `rgb(...)` string for `mal_id === undefined / null`
 * so empty-state cards still get a coherent fill instead of the
 * default `bg-ink-2`. The "fallback" slot is the warm sumi.
 */
export function coverPaletteFor(mal_id) {
  if (mal_id == null) return PALETTE[5];
  // Math.abs handles negative custom mal_ids; the modulo distributes
  // evenly because the palette length is a power of 2.
  return PALETTE[Math.abs(mal_id | 0) % PALETTE.length];
}
