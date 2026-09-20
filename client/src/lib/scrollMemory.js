/**
 * 記 · Scroll memory, one position per history entry.
 *
 * Browsers restore scroll per entry when they drive the page. This app
 * drives itself (`history.scrollRestoration = "manual"`) because its
 * pages get their height from Dexie and from a virtualizer a frame or
 * two after they mount, and the browser's own restore fires before that
 * and clamps against a skeleton. So the app keeps the ledger instead:
 * the key React Router gives every history entry (`location.key`) maps
 * to the last `scrollY` the reader left it at.
 *
 * A dashboard-only memory lived here before, under one global key. It
 * could not tell two library entries apart — three round trips deep,
 * "back" landed on the *latest* position rather than that entry's own —
 * and every other page had no memory at all, so a series reached with
 * "forward" inherited whatever offset the previous page had.
 *
 * Only the library's entries are recorded (see `remembersScroll`): the
 * reader asked for the shelf to come back where it was, and for every
 * other page to open at its top.
 *
 * In-memory first, mirrored to `sessionStorage` so a reload finds the
 * current entry's position again (the router restores `location.key`
 * from `history.state`). Bounded: a long session pushes many entries.
 */

const PREFIX = "mc:scroll:";
const MAX_ENTRIES = 200;

/**
 * 棚 · The one page whose position is worth keeping: the library, a
 * long shelf a reader scrolls, leaves for a series and comes back to.
 * Every other page starts at the top on every arrival, back included —
 * a series page or the backlog reopening half-way down read as being
 * in the wrong place, not as being remembered.
 */
const REMEMBERED_ROUTES = new Set(["/dashboard"]);

/** Does this route keep its scroll position across a back navigation? */
export function remembersScroll(pathname) {
  return REMEMBERED_ROUTES.has(pathname);
}

/** How long a restore may wait for the page to grow tall enough. */
export const RESTORE_WAIT_MS = 1500;
/** After placing, how long we keep the position against the mount's own
 *  scrolls (the window virtualizer scrolls to its initial offset as it
 *  attaches; a push navigation scrolls to the top). */
export const RESTORE_ASSERT_MS = 400;

const memory = new Map();

function storage() {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The remembered position for a history entry, or `null` if none. */
export function readScroll(key) {
  if (!key) return null;
  if (memory.has(key)) return memory.get(key);
  const raw = storage()?.getItem(PREFIX + key);
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  memory.set(key, n);
  return n;
}

/** Remember where a history entry is scrolled to. */
export function writeScroll(key, y) {
  if (!key) return;
  const n = Math.max(0, Math.round(Number(y) || 0));
  if (!memory.has(key) && memory.size >= MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    memory.delete(oldest);
    try {
      storage()?.removeItem(PREFIX + oldest);
    } catch {
      /* quota / private mode — non-fatal */
    }
  }
  memory.set(key, n);
  try {
    storage()?.setItem(PREFIX + key, String(n));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

/**
 * Can the document, at its current height, be scrolled to `target`?
 * A `scrollTo` issued before this is true is clamped and lands short.
 */
export function canHold(scrollHeight, viewportHeight, target) {
  return Math.max(0, scrollHeight - viewportHeight) >= target;
}

/** Test seam. */
export function _resetScrollMemory() {
  memory.clear();
}
