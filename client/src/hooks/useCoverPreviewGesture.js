import { useCallback, useEffect, useRef } from "react";

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
 * The hook doesn't own any visibility state — that's all upstream in the
 * `useVolumePreviewController`. Its only local state is the click-
 * suppression flag: when a long-press fires, the click event that would
 * follow the release should NOT toggle ownership.
 */
export function useCoverPreviewGesture({
  enabled = true,
  onShow,
  onRelease,
  hoverDelayMs = 400,
  longPressDelayMs = 500,
  moveThresholdPx = 8,
} = {}) {
  const timerRef = useRef(null);
  const startRef = useRef({ x: 0, y: 0 });
  const suppressClickRef = useRef(false);

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
    if (!timerRef.current) return;
    if (e.pointerType === "mouse") return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (Math.hypot(dx, dy) > moveThresholdPx) {
      clearTimer();
    }
  };

  const onPointerUp = (e) => {
    if (e.pointerType === "mouse") return;
    // On touch we only cancel a PENDING long-press timer. Once the
    // preview has actually fired (suppressClickRef set), we leave it
    // visible — the controller handles sticky dismissal.
    clearTimer();
  };

  const onPointerCancel = () => {
    clearTimer();
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
