import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import {
  RESTORE_ASSERT_MS,
  RESTORE_WAIT_MS,
  canHold,
  readScroll,
  remembersScroll,
  writeScroll,
} from "@/lib/scrollMemory.js";

/**
 * 指 · Which input counts as the reader scrolling, once the position has
 * been put back. A trackpad swipe-back sends *horizontal* `wheel` events
 * to the page as it arrives — that gesture is how we got here, not a
 * wish to move — so only a clearly vertical wheel counts, along with a
 * touch drag and the keyboard. Nothing counts before placement: an
 * unplaced page shows the previous page's offset, which nobody wants.
 */
function isReaderScroll(e) {
  if (e.type === "wheel") {
    return Math.abs(e.deltaY) > 10 && Math.abs(e.deltaY) > Math.abs(e.deltaX);
  }
  return true;
}
const INPUT_EVENTS = ["wheel", "touchmove", "keydown"];

/**
 * 戻 · Where each history entry was scrolled to, kept and put back.
 *
 * Mounted once, in the app shell: it decides the scroll position of
 * every page on every navigation — the top for all of them, except the
 * library coming back to where it was.
 *
 * Three rules, and each one is a bug that was fixed:
 *
 *   1. Only the library remembers (`remembersScroll`). Every other page
 *      starts at the top on every arrival. On the library, a push or
 *      replace starts at the top too; a pop (back, forward, or the
 *      series page's own "back to library", which is a real step back)
 *      restores that history entry's position — and an entry with no
 *      memory goes to the top rather than keeping the offset of the
 *      page we came from.
 *
 *   2. Restoring waits until the page can hold the position. The
 *      virtualized grid gets its height a frame after the rows arrive
 *      from Dexie; a `scrollTo` issued before that clamps against a
 *      skeleton. That presumes the grid reports its true height from
 *      its first paint — `useWindowGridVirtualizer` learns and
 *      remembers the row height for exactly this reason. With a guess
 *      34 px short per row, a position in the grid's tail could not be
 *      held until those rows were measured, and they were not measured
 *      until the position was reached, so the restore sat out its full
 *      cap and then descended in hops. Then it holds the position for a short while against
 *      the mount's own scrolls (the window virtualizer scrolls to its
 *      initial offset as it attaches), and lets go if the reader really
 *      scrolls — a vertical wheel, a touch drag, a key. A trackpad
 *      swipe-back sends horizontal wheel events to the page it lands on;
 *      treating those as intent cancelled the restore and, worse, wrote
 *      the unrestored position over the memory.
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
    // `record` also notes the position as it stands; a cancel passes
    // `false` so a spurious cancel can never overwrite a good memory.
    const arm = (record = true) => {
      armedRef.current = true;
      if (record) writeScroll(location.key, window.scrollY);
    };

    if (!remembersScroll(location.pathname)) {
      // Not a page we remember: the top, on every kind of arrival, and
      // nothing recorded.
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      return undefined;
    }

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
    // Only listened to once the position is in place (see below).
    const onInput = (e) => {
      if (!isReaderScroll(e)) return;
      stop();
      arm(false);
    };
    const listenForReader = () => {
      for (const ev of INPUT_EVENTS) {
        window.addEventListener(ev, onInput, { passive: true });
      }
    };

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
          listenForReader();
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
  }, [location.key, location.pathname, navType]);
}
