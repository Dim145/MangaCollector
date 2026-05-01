import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Gesture handler for triggering the shared cover preview:
 *   - Desktop (mouse): pointer-enter → ~400ms dwell → `onShow(rect, false)`
 *     (non-sticky peek). Pointer-leave → `onRelease()`.
 *   - Touch / pen: pointer-down → ~500ms long-press → `onShow(rect, true)`
 *     (sticky) + haptic buzz. Pointer-up / cancel / finger-move cancels
 *     the pending long-press, but once it has fired the preview stays
 *     visible and dismissal is handled by the controller (outside-tap,
 *     zoom trigger).
 *
 * Optional touch swipe (when `onSwipeCommit` is supplied):
 *   - Horizontal-dominant drags (|dx| > 1.4×|dy|) past `swipeMoveThresholdPx`
 *     enter "swipe mode" — the long-press timer is cancelled and `swipeDx`
 *     starts updating. The caller renders progressive feedback (translate
 *     + colour tint).
 *   - On pointer-up, if |dx| ≥ `swipeCommitThresholdPx` we fire
 *     `onSwipeCommit("right" | "left")` and consume the post-release click
 *     so the existing onClick toggle doesn't double-fire. Below threshold
 *     the gesture is cancelled — the caller animates the offset back to 0.
 *
 * The hook doesn't own any visibility state — that's all upstream in the
 * `useVolumePreviewController`. Its only local state is the click-
 * suppression flag and (when swipe is active) the live `swipeDx` value.
 */
export function useCoverPreviewGesture({
  enabled = true,
  onShow,
  onRelease,
  onSwipeCommit,
  hoverDelayMs = 400,
  longPressDelayMs = 500,
  moveThresholdPx = 8,
  swipeMoveThresholdPx = 14,
  swipeCommitThresholdPx = 56,
} = {}) {
  const timerRef = useRef(null);
  const startRef = useRef({ x: 0, y: 0 });
  const suppressClickRef = useRef(false);
  // Swipe state. `swipingRef` is the imperative latch (so pointer-move can
  // read it without waiting for a setState round-trip); `swipeDx` is the
  // public state value that triggers re-renders on the consumer side.
  const swipingRef = useRef(false);
  const [swipeDx, setSwipeDx] = useState(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const onPointerEnter = (e) => {
    if (!enabled) return;
    if (e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    clearTimer();
    timerRef.current = setTimeout(() => {
      onShow?.(el.getBoundingClientRect(), false);
    }, hoverDelayMs);
  };

  const onPointerLeave = (e) => {
    if (e.pointerType !== "mouse") return;
    clearTimer();
    onRelease?.();
  };

  const onPointerDown = (e) => {
    if (!enabled) return;
    if (e.pointerType === "mouse") return;
    const el = e.currentTarget;
    startRef.current = { x: e.clientX, y: e.clientY };
    clearTimer();
    timerRef.current = setTimeout(() => {
      onShow?.(el.getBoundingClientRect(), true);
      suppressClickRef.current = true;
      try {
        navigator.vibrate?.(8);
      } catch {
        /* unsupported */
      }
    }, longPressDelayMs);
  };

  const onPointerMove = (e) => {
    if (e.pointerType === "mouse") return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;

    // Long-press: any motion past the move threshold cancels the
    // pending timer. This MUST run before the swipe branch since a
    // user starting to swipe should never accidentally trigger the
    // preview mid-drag.
    if (timerRef.current && Math.hypot(dx, dy) > moveThresholdPx) {
      clearTimer();
    }

    if (!onSwipeCommit) return;
    // Latch into "swiping" once we see a horizontal-dominant drag past
    // the activation threshold. The 1.4× ratio filters out diagonal
    // intent (page scroll, etc.) — the user has to deliberately move
    // sideways for swipe-to-toggle to engage.
    if (!swipingRef.current) {
      if (Math.abs(dx) > swipeMoveThresholdPx && Math.abs(dx) > 1.4 * Math.abs(dy)) {
        swipingRef.current = true;
      } else {
        return;
      }
    }
    setSwipeDx(dx);
    // Once swiping is active we suppress the post-release click in
    // every direction, including a release-back-to-zero — the user
    // clearly wasn't tapping. Cancel handler resets this.
    suppressClickRef.current = true;
  };

  const onPointerUp = (e) => {
    if (e.pointerType === "mouse") return;
    // On touch we only cancel a PENDING long-press timer. Once the
    // preview has actually fired (suppressClickRef set), we leave it
    // visible — the controller handles sticky dismissal.
    clearTimer();
    if (swipingRef.current) {
      const dx = swipeDx;
      swipingRef.current = false;
      setSwipeDx(0);
      if (Math.abs(dx) >= swipeCommitThresholdPx) {
        onSwipeCommit?.(dx > 0 ? "right" : "left");
      }
    }
  };

  const onPointerCancel = () => {
    clearTimer();
    if (swipingRef.current) {
      swipingRef.current = false;
      setSwipeDx(0);
    }
  };

  const consumeClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return true;
    }
    return false;
  };

  return {
    consumeClick,
    swipeDx,
    swipeCommitThresholdPx,
    handlers: {
      onPointerEnter,
      onPointerLeave,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
  };
}
