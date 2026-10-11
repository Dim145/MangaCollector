/**
 * 温 · The last answer of the shelf's own reads, for the next mount.
 *
 * `useLiveQuery` answers `undefined` on its first render, whatever it
 * answered a moment before: Dexie is asked again and replies a few
 * milliseconds later. The library mounting again — "back" from a series
 * — painted its skeleton for that long, then its shelf at the top, and
 * only then could the scroll memory put it back where the reader had
 * been. Started from the last answer, its first render already holds
 * the shelf, the position is restored before anything is painted, and
 * the live query replaces the answer a moment later — with the same
 * rows, unless something changed meanwhile.
 *
 * Module state, on purpose: it must outlive the page, and only this
 * page's life. Wiped with the caches it mirrors (`lib/db.js`), so the
 * shelf of one account can never open the page of another.
 */

const last = new Map();

/** The last answer of a read, or `undefined` before the first. */
export function lastRead(name) {
  return last.get(name);
}

/** Remember an answer (an `undefined` one — still loading — is ignored). */
export function rememberRead(name, value) {
  if (value !== undefined) last.set(name, value);
}

/** Forget every answer: the caches they mirror were wiped. */
export function forgetReads() {
  last.clear();
}
