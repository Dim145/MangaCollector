/**
 * 始 · Welcome-tour state — two distinct stores, two distinct lifetimes.
 *
 * "seen" lives in **localStorage**. It marks "the user has dismissed the
 * intro" and persists across browser restarts. Re-installing the PWA on
 * a fresh device intentionally re-shows the tour (different physical
 * context, fresh onboarding moment).
 *
 * "step" lives in **sessionStorage**. It carries which destination the
 * user just clicked from the tour modal (library / scan / avatar). The
 * destination page consumes the value at mount time and clears it,
 * triggering its own focus / open / highlight choreography. Session-
 * scoped so a manual reload (or a stray bookmark) doesn't replay the
 * tour spotlight a week later.
 */

const SEEN_KEY = "mc:tour-seen";
const STEP_KEY = "mc:tour-step";

// Valid step ids — kept as a frozen set so consumers can't smuggle in
// arbitrary strings via storage manipulation. Pages branch on these
// identifiers, so the contract is small on purpose.
export const TOUR_STEPS = Object.freeze({
  LIBRARY: "library", // → focus the AddPage search input
  SCAN: "scan", // → open the AddPage barcode scanner
  AVATAR: "avatar", // → spotlight the ProfilePage avatar button
});

const VALID_STEPS = new Set(Object.values(TOUR_STEPS));

/** Persist "the user has seen the tour" — gates the auto-open path. */
export function markTourSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode / quota — non-fatal */
  }
}

/** Has the tour been dismissed before? Returns false on quota errors. */
export function hasSeenTour() {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Wipe the seen flag — used by the Settings replay entry. */
export function resetTourSeen() {
  try {
    localStorage.removeItem(SEEN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Stash which tour step the user just engaged with. The destination
 * page reads this with `consumeTourStep()` to trigger its focus /
 * open / highlight behaviour. No-ops on invalid step ids.
 */
export function setTourStep(step) {
  if (!VALID_STEPS.has(step)) return;
  try {
    sessionStorage.setItem(STEP_KEY, step);
  } catch {
    /* ignore */
  }
}

/**
 * Read the tour step AND clear it in the same call. Designed to be
 * called once at mount on the destination page; after the read, the
 * value is gone, so a manual reload or back-button doesn't replay
 * the spotlight indefinitely.
 */
export function consumeTourStep() {
  try {
    const v = sessionStorage.getItem(STEP_KEY);
    if (v) sessionStorage.removeItem(STEP_KEY);
    return VALID_STEPS.has(v) ? v : null;
  } catch {
    return null;
  }
}
