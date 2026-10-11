import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import {
  RESTORE_ASSERT_MS,
  RESTORE_WAIT_MS,
  announceRestore,
  canHold,
  endRestore,
  readScroll,
  remembersScroll,
  restoreLaidOut,
  writeScroll,
} from "@/lib/scrollMemory.js";
import { isScrollAdjusting } from "@/lib/scrollAdjusting.js";

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
 *      It places the position before the first frame whenever it can:
 *      the target is announced while the shell renders, so the grid's
 *      first render already lays out the rows the reader comes back to
 *      (`restoringTo`), and the page is put there from the layout effect
 *      — before paint — as soon as it is tall enough. The library's own
 *      reads start from their last answer (`lib/warmReads.js`), so on a
 *      "back" that is the very first frame: no skeleton, no shelf top,
 *      no jump. The frame-by-frame wait remains for a cold start.
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
  // Does the page we are on keep its position at all?
  const remembersRef = useRef(remembersScroll(location.pathname));

  // 先 · Said while rendering, before the page under the shell renders:
  // its grid reads it to lay out the right rows from the start. Once per
  // entry — a later render of the shell, after the restore has landed,
  // must not send a grid created then back to the target.
  const announcedRef = useRef(null);
  if (announcedRef.current !== location.key) {
    announcedRef.current = location.key;
    announceRestore(
      location.key,
      navType === "POP" && remembersScroll(location.pathname)
        ? readScroll(location.key)
        : null,
    );
  }

  useLayoutEffect(() => {
    if (typeof window === "undefined" || !window.history) return;
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    let pending = false;
    let lastHeight = document.documentElement.scrollHeight;
    const onScroll = () => {
      if (!armedRef.current || pending) return;
      pending = true;
      const key = keyRef.current;
      requestAnimationFrame(() => {
        pending = false;
        // Scheduled for an entry we have since left: the position we
        // would read now belongs to the new page.
        if (!armedRef.current || keyRef.current !== key) return;

        // 落 · A page that shrinks under the reader drags the scroll
        // down with it, and the browser reports that as a scroll like
        // any other. It is not a position anyone chose, and recording
        // it overwrites one they did: leaving the library for a series
        // shortens the document while this entry is still the current
        // one, so "back" came back six hundred pixels above where the
        // reader had been. A scroll that lands exactly on a *reduced*
        // maximum is that, and nothing else.
        const height = document.documentElement.scrollHeight;
        const shrank = height < lastHeight;
        lastHeight = height;
        const bottom = Math.max(0, height - window.innerHeight);
        if (shrank && Math.abs(window.scrollY - bottom) <= 1) return;

        // 整 · Nor is the virtualizer correcting its own estimate a
        // position anyone chose. See `lib/scrollAdjusting.js`.
        if (isScrollAdjusting()) return;

        writeScroll(key, window.scrollY);
      });
    };
    // 押 · The press is the last moment the position is the reader's.
    //
    // Clicking a card scrolls the page by itself — the browser reveals
    // what it just focused, and the series page mounts under the old
    // document — and every one of those scrolls looked exactly like a
    // reader's. The library recorded the last of them, so "back"
    // returned six hundred pixels above the card that was clicked.
    //
    // So: write where they were when they pressed, and stop listening.
    // Recording resumes on the next scroll they actually perform — the
    // same test the restore uses to decide it has been overruled.
    const onPointerDown = () => {
      if (!remembersRef.current) return;
      if (armedRef.current) writeScroll(keyRef.current, window.scrollY);
      armedRef.current = false;
    };
    const onReaderInput = (event) => {
      if (remembersRef.current && isReaderScroll(event)) {
        armedRef.current = true;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, true);
    for (const ev of INPUT_EVENTS) {
      window.addEventListener(ev, onReaderInput, { passive: true });
    }
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointerdown", onPointerDown, true);
      for (const ev of INPUT_EVENTS) {
        window.removeEventListener(ev, onReaderInput);
      }
    };
  }, []);

  useLayoutEffect(() => {
    keyRef.current = location.key;
    armedRef.current = false;
    remembersRef.current = remembersScroll(location.pathname);
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
      endRestore(location.key);
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      arm();
      return undefined;
    }

    // Said again here: the announcement made while rendering is cleared
    // by a cleanup (development runs every effect twice), and a grid
    // created after this point must still start from the target.
    announceRestore(location.key, target);

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
      endRestore(location.key);
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

    // Put the page where it was, once it can hold the position (or the
    // wait is over), and let the grid that started from the announced
    // target read the real offset from now on.
    const settle = (now) => {
      place();
      placed = true;
      placedAt = now;
      endRestore(location.key);
      // Whoever follows the scroll hears about the move in this frame,
      // not the next: the browser's own `scroll` event comes a frame
      // later, and the first frame back showed the previous page's
      // header over the shelf — or, where the page landed short of the
      // target, a grid still laid out for the target. After the layout
      // effects, before paint: a grid that re-renders from it may flush.
      queueMicrotask(() => window.dispatchEvent(new Event("scroll")));
      listenForReader();
    };

    const tick = () => {
      if (cancelled) return;
      const now = performance.now();
      if (!placed) {
        const ready =
          canHold(document.documentElement.scrollHeight, window.innerHeight, target) ||
          restoreLaidOut();
        if (ready || now - started > RESTORE_WAIT_MS) settle(now);
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
    // Already tall enough — the shelf rendered from its last reads in
    // this very commit: placed now, before the first frame is painted.
    // (A grid laid out for the target has its height: no waiting on it.)
    if (
      canHold(document.documentElement.scrollHeight, window.innerHeight, target) ||
      restoreLaidOut()
    ) {
      settle(started);
    }
    raf = requestAnimationFrame(tick);

    // The cleanup runs on the next navigation — and on the simulated
    // remount React performs in development, after which the effect runs
    // again from scratch with no ref left behind to skip it.
    return stop;
  }, [location.key, location.pathname, navType]);
}
