import { useEffect, useRef, useState } from "react";

const PULL_THRESHOLD = 70; // px of pull before commit
const MAX_PULL = 120; // px cap so the indicator doesn't fly off
const DAMPING = 0.5; // 1 = 1:1 finger travel; 0.5 feels rubber-band-y

/**
 * 引 · Pull-to-refresh wrapper.
 *
 * Attaches global touch listeners that trigger `onRefresh()` when the
 * user pulls down past `PULL_THRESHOLD` while the page is scrolled to
 * the top. Touch-only — desktop / mouse users see no indicator and
 * pay nothing (the listeners no-op without a touch start).
 *
 * Visual: a circular hanko-tinted badge near the top centre that
 * grows in opacity as the user pulls, with a kanji that flips when
 * the threshold is crossed (a tactile "release to refresh" cue), and
 * becomes a spinner during the refresh itself.
 *
 * The component wraps `children` rather than rendering above them so
 * a parent can compose it with the page layout naturally:
 *   <PullToRefresh onRefresh={...}>
 *     <DashboardGrid />
 *   </PullToRefresh>
 *
 * Honours `prefers-reduced-motion`: indicator still renders (the
 * action is intentional, not ambient) but transitions are stripped.
 */
export default function PullToRefresh({ onRefresh, children }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef(null);
  // Mirror state into a ref so the touch listeners (re-bound only on
  // mount) can read the latest values without re-binding per render.
  const pullDistanceRef = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    pullDistanceRef.current = pullDistance;
  }, [pullDistance]);
  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  useEffect(() => {
    const onTouchStart = (e) => {
      // Only arm pull tracking when the page is genuinely at the top.
      // Anywhere else, a downward swipe should scroll up — not pull.
      // Multi-touch (pinch) is also ignored: only single-finger drags
      // count as a pull intent.
      if (window.scrollY > 0) return;
      if (e.touches.length !== 1) return;
      if (refreshingRef.current) return;
      startYRef.current = e.touches[0].clientY;
    };

    const onTouchMove = (e) => {
      if (startYRef.current == null) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0) {
        // Pulling up (= scrolling down) — release the pull state and
        // let native scroll handle it.
        if (pullDistanceRef.current !== 0) setPullDistance(0);
        return;
      }
      // Damped pull distance for a rubber-band feel; capped so the
      // indicator never wanders off-screen on aggressive yanks.
      const damped = Math.min(MAX_PULL, dy * DAMPING);
      setPullDistance(damped);
      // Suppress the browser's native overscroll bounce only after the
      // user has clearly committed to a pull (>5px). Below that, we
      // leave default behaviour alone so a tap-and-tiny-jitter doesn't
      // feel laggy. Listener is registered as `passive: false` so this
      // call is allowed.
      if (dy > 5) e.preventDefault();
    };

    const onTouchEnd = async () => {
      const distance = pullDistanceRef.current;
      startYRef.current = null;
      setPullDistance(0);
      if (distance < PULL_THRESHOLD || refreshingRef.current) return;
      // Brief tactile feedback when commit fires — same `vibrate(15)`
      // pattern the seal ceremony uses. iOS Safari ignores it; nobody
      // notices on devices that lack the API.
      try {
        navigator.vibrate?.(15);
      } catch {
        /* unsupported — silent */
      }
      setRefreshing(true);
      try {
        await onRefreshRef.current?.();
      } catch {
        // Swallow: the refresh callback decides whether to surface
        // errors via toast or other UI. We just stop spinning.
      } finally {
        setRefreshing(false);
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    // Must NOT be passive — we conditionally call preventDefault.
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", onTouchEnd);

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
    // No deps — listeners read state via refs above.
  }, []);

  const visible = pullDistance > 0 || refreshing;
  // Threshold-cross marker — flips kanji + colour shift to telegraph
  // "release now to commit". Same idea as iOS pull-to-refresh's
  // arrow-flip moment.
  const ready = pullDistance >= PULL_THRESHOLD;

  return (
    <>
      {visible && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed left-1/2 top-3 z-[60] -translate-x-1/2"
          style={{
            transform: `translate(-50%, ${refreshing ? 0 : Math.max(0, pullDistance - 40)}px)`,
            opacity: refreshing ? 1 : Math.min(1, pullDistance / PULL_THRESHOLD),
            transition: refreshing
              ? "transform 200ms cubic-bezier(0.16, 1, 0.3, 1)"
              : "none",
          }}
        >
          <div
            className={`grid h-11 w-11 place-items-center rounded-full border backdrop-blur-md transition-colors ${
              ready || refreshing
                ? "border-hanko/60 bg-hanko/25"
                : "border-border bg-ink-1/80"
            }`}
          >
            {refreshing ? (
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-hanko-bright border-t-transparent"
                role="status"
              />
            ) : (
              <span
                className={`font-jp text-base font-bold leading-none transition-all duration-200 ${
                  ready ? "text-hanko-bright" : "text-washi-muted"
                }`}
                style={{
                  transform: ready ? "rotate(180deg)" : "rotate(0deg)",
                }}
              >
                {/* 引 · "pull". Flips on threshold-cross to mirror the
                    "release now" affordance. */}
                引
              </span>
            )}
          </div>
        </div>
      )}
      {children}
    </>
  );
}
