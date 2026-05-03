import { useEffect, useRef } from "react";

/**
 * 最新 · Always-fresh ref for a value that callbacks defined inside
 * a long-lived `useEffect` (empty deps, mount-once subscription)
 * need to read.
 *
 * Pattern problem: a subscription effect closes over its initial
 * render's values. If those values change later (e.g. the i18n
 * `t` flips when settings load FR), the effect's closure keeps
 * the original — surfaces as a stale-closure bug
 * (`SealsUnlockToaster` showing English text after the locale
 * switched to French).
 *
 * Pattern fix: write the latest value into a ref in a separate
 * effect on `[value]`, then read `.current` from inside the
 * subscription. The subscription stays mounted across value
 * changes (no listener tear-down + re-attach) but always sees
 * fresh data.
 *
 *   const latestT = useLatest(useT());
 *   useEffect(() => {
 *     const off = onSomething(() => latestT.current("key"));
 *     return off;
 *   }, []);
 */
export function useLatest(value) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
