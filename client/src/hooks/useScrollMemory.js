import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import {
  RESTORE_ASSERT_MS,
  RESTORE_WAIT_MS,
  canHold,
  readScroll,
  writeScroll,
} from "@/lib/scrollMemory.js";

/** Real input from the reader while a restore is in flight ends it: their intent wins. */
const INPUT_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"];

/**
 * 戻 · Where each history entry was scrolled to, kept and put back.
 *
 * Mounted once, in the app shell, so every page gets it — the library,
 * the backlog, a series reached with "forward", all of them.
 *
 * Three rules, and each one is a bug that was fixed:
 *
 *   1. A push or replace navigation starts at the top. A pop (back,
 *      forward, or the library's own "back" button, which is a real
 *      step back) restores that entry's remembered position — and an
 *      entry with no memory goes to the top rather than keeping the
 *      offset of the page we came from, which is what a series looked
 *      like when reached with "forward" after a scrolled library.
 *
 *   2. Restoring waits until the page can hold the position. The
 *      virtualized grid gets its height a frame after the rows arrive
 *      from Dexie; a `scrollTo` issued before that clamps against a
 *      skeleton. Then it holds the position for a short while against
 *      the mount's own scrolls (the window virtualizer scrolls to its
 *      initial offset as it attaches), and lets go the moment the reader
 *      touches anything.
 *
 *   3. Nothing is recorded until the restore has had its say. The mount
 *      is full of scrolls that are not the reader's, and persisting them
 *      wrote `0` — or the previous page's offset — over the position we
 *      were about to restore. A throttled write also checks that the
 *      entry it was scheduled for is still the current one.
 *
 * Browser restoration is switched off because it fires before any of
 * this can have happened.
 */
export function useScrollMemory() {
  const location = useLocation();
  const navType = useNavigationType();
  const keyRef = useRef(location.key);
  // May the scroll listener record for the current entry yet?
  const armedRef = useRef(false);

  useLayoutEffect(() => {
    if (typeof window === "undefined" || !window.history) return;
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    let pending = false;
    const onScroll = () => {
      if (!armedRef.current || pending) return;
      pending = true;
      const key = keyRef.current;
      requestAnimationFrame(() => {
        pending = false;
        // Scheduled for an entry we have since left: the position we
        // would read now belongs to the new page.
        if (!armedRef.current || keyRef.current !== key) return;
        writeScroll(key, window.scrollY);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    keyRef.current = location.key;
    armedRef.current = false;
    const arm = () => {
      armedRef.current = true;
      writeScroll(location.key, window.scrollY);
    };

    if (navType !== "POP") {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      arm();
      return undefined;
    }

    const target = readScroll(location.key);
    if (!target) {
      // Nothing remembered (an entry from before this build, or one left
      // at the top): the top, not the previous page's offset.
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      arm();
      return undefined;
    }

    let raf = 0;
    let cancelled = false;
    let placed = false;
    let placedAt = 0;
    let asserts = 0;
    const started = performance.now();

    const goal = () =>
      Math.min(
        target,
        Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      );
    const place = () => {
      window.scrollTo({ top: goal(), left: 0, behavior: "instant" });
    };
    const stop = () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      for (const ev of INPUT_EVENTS) window.removeEventListener(ev, onInput);
    };
    const onInput = () => {
      stop();
      arm();
    };
    for (const ev of INPUT_EVENTS) {
      window.addEventListener(ev, onInput, { passive: true });
    }

    const tick = () => {
      if (cancelled) return;
      const now = performance.now();
      if (!placed) {
        const ready = canHold(
          document.documentElement.scrollHeight,
          window.innerHeight,
          target,
        );
        if (ready || now - started > RESTORE_WAIT_MS) {
          place();
          placed = true;
          placedAt = now;
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      if (now - placedAt < RESTORE_ASSERT_MS) {
        if (Math.abs(window.scrollY - goal()) > 2 && asserts < 5) {
          place();
          asserts += 1;
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      stop();
      arm();
    };
    raf = requestAnimationFrame(tick);

    // The cleanup runs on the next navigation — and on the simulated
    // remount React performs in development, after which the effect runs
    // again from scratch with no ref left behind to skip it.
    return stop;
  }, [location.key, navType]);
}
