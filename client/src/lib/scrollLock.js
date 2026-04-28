/**
 * 鎖 · Body-scroll lock — single shared reference counter.
 *
 * Every component that locks the body scroll (Modal, VolumeDetailDrawer,
 * AddPage's scanner overlay, …) MUST go through this module. Holding
 * separate per-component counters caused a leak when two locking
 * components overlapped lifecycles:
 *
 *   1. A locks scroll       → captures original="" → sets overflow=hidden
 *   2. B mounts while A is still active → captures original="hidden"
 *      ← contaminated by A's prior write
 *   3. A unmounts → restores its captured ""        → overflow=""
 *   4. B unmounts → restores its captured "hidden"  → overflow=hidden 💥
 *
 * After step 4 nothing is open, but the body is still scroll-locked. The
 * symptom: page becomes unscrollable (clicks still work) until reload.
 *
 * The fix is to share the counter so the snapshot of the original overflow
 * is taken EXACTLY ONCE — when the first lock acquires — and restored
 * exactly once — when the last lock releases. Independent of which
 * component opened or closed first, the body's pre-lock state is preserved.
 *
 * Why a module-level singleton (and not a React context):
 *   - The lock state is conceptually a property of `document.body`, not
 *     of any subtree. A context would force every component that locks
 *     scroll to also be inside a provider, adding boilerplate without
 *     buying anything.
 *   - The counter is purely imperative — no rendering depends on it.
 */

let activeLockCount = 0;
let originalBodyOverflow = null;

/**
 * Increment the lock counter. The first call captures the body's
 * pre-lock `overflow` value and applies `hidden`; subsequent calls are
 * cheap counter bumps.
 */
export function acquireScrollLock() {
  if (typeof document === "undefined") return;
  if (activeLockCount === 0) {
    originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  activeLockCount += 1;
}

/**
 * Decrement the lock counter. The final call (counter back to 0)
 * restores the captured pre-lock `overflow` value. Calls beyond zero
 * are clamped — defensive against double-release from a single
 * component, which would otherwise underflow into negative counts and
 * leave the body permanently locked the next time a single modal opens.
 */
export function releaseScrollLock() {
  if (typeof document === "undefined") return;
  activeLockCount = Math.max(0, activeLockCount - 1);
  if (activeLockCount === 0) {
    document.body.style.overflow = originalBodyOverflow ?? "";
    originalBodyOverflow = null;
  }
}
