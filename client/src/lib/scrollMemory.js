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

/** How long a restore may wait for the page to grow tall enough. A
 *  safety net for a slow device's skeleton phase, not a path anything
 *  should take: a page at its true height is holdable at once, and a
 *  restore that reaches this cap is a page reporting a height it does
 *  not have (see `useWindowGridVirtualizer`). */
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

/**
 * 先 · Where the restore under way is taking the page.
 *
 * A windowed grid decides which rows to render from the scroll offset
 * it reads when it is created. Mounted on a "back" while the page still
 * sits at the previous page's offset, it rendered the rows for *that*
 * place, the restore then moved the window, and the frame painted in
 * between showed the shelf's top — or nothing, where the rows for the
 * restored offset had not been rendered yet. The app shell announces
 * the target while it renders (before the page under it does), the
 * grid starts from it (`useWindowGridVirtualizer`), and the first frame
 * already holds the rows the reader comes back to.
 *
 * Keyed by the history entry, so a stale announcement can never steer
 * the grid of another entry.
 */
const NONE = { key: null, y: null, laidOut: false };
let pending = NONE;

/** Called while the app shell renders an arrival (and again, unchanged,
 *  from its effect — which must not forget a grid already laid out). */
export function announceRestore(key, y) {
  const target = Number.isFinite(y) ? y : null;
  if (pending.key === key && pending.y === target) return;
  pending = { key, y: target, laidOut: false };
}

/** The restore target, while one is under way. */
export function restoringTo() {
  return pending.y;
}

/**
 * A windowed grid has laid its rows out for the target. Its height is
 * then known, so there is nothing left to wait for: if the page cannot
 * hold the position now, it never will (the shelf got shorter), and
 * waiting would leave the grid showing the rows of a place the page is
 * not at — an empty band — until the wait ran out.
 */
export function noteRestoreLaidOut() {
  if (pending.y != null) pending = { ...pending, laidOut: true };
}

export function restoreLaidOut() {
  return pending.laidOut;
}

/** The position is in place (or the restore was abandoned). */
export function endRestore(key) {
  if (key == null || pending.key === key) pending = NONE;
}

/** Test seam. */
export function _resetScrollMemory() {
  memory.clear();
  pending = NONE;
}
