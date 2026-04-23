import { useCallback, useEffect, useState } from "react";

/**
 * Centralised preview controller for MangaPage.
 *
 * Owns the "which volume's cover is currently previewed" state so that:
 *   - Only ONE <CoverPreview /> exists on the page (portaled, clean DOM)
 *   - Keyboard ← / → can jump between adjacent volumes (needs to know
 *     siblings — each Volume only knows itself)
 *   - Tap-outside / Escape dismiss works uniformly
 *   - A separate "zoom" mode opens a full modal when the user taps the
 *     preview itself (mobile sticky UX)
 *
 * Two display modes:
 *   - `sticky: false` — desktop hover peek. Dismissed by the Volume that
 *     owns the gesture when the mouse leaves (calls `release()`).
 *   - `sticky: true`  — mobile long-press peek. Stays until the user taps
 *     outside or opens the zoom. Release of the long-press does NOT
 *     dismiss.
 *
 * Keyboard navigation builds a sorted list of volumes that actually have
 * a cover, wraps around at the ends. Each nav locates the target's DOM
 * node via `data-vol-num="{n}"` to compute the new anchor rect.
 */
export function useVolumePreviewController({ coverMap }) {
  const [state, setState] = useState({
    volNum: null,
    anchorRect: null,
    sticky: false,
  });
  const [zoomOpen, setZoomOpen] = useState(false);

  const url = state.volNum != null ? coverMap?.[state.volNum] : null;
  const visible = url != null;

  /** Show the preview anchored to a DOM element. */
  const show = useCallback((volNum, anchorRect, sticky = false) => {
    if (volNum == null) return;
    setState({ volNum, anchorRect, sticky });
  }, []);

  /** Release the preview (used by mouse-leave on desktop). No-op when the
   * current preview is sticky — the user must explicitly dismiss. */
  const release = useCallback(() => {
    setState((prev) => (prev.sticky ? prev : { volNum: null, anchorRect: null, sticky: false }));
  }, []);

  const hide = useCallback(() => {
    setState({ volNum: null, anchorRect: null, sticky: false });
    setZoomOpen(false);
  }, []);

  // Keyboard navigation: ← / → jump across volumes that have covers.
  // Escape always dismisses.
  useEffect(() => {
    if (!visible) return;

    const sortedVolsWithCovers = Object.keys(coverMap ?? {})
      .map((k) => parseInt(k, 10))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        hide();
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (sortedVolsWithCovers.length < 2) return;
      e.preventDefault();
      const idx = sortedVolsWithCovers.indexOf(state.volNum);
      if (idx < 0) return;
      const dir = e.key === "ArrowLeft" ? -1 : 1;
      const nextIdx =
        (idx + dir + sortedVolsWithCovers.length) % sortedVolsWithCovers.length;
      const nextVolNum = sortedVolsWithCovers[nextIdx];
      // Re-anchor on the target volume's DOM thumbnail. Once there's
      // keyboard interaction we consider the preview sticky (the user
      // is browsing, not just hovering).
      const el = document.querySelector(`[data-vol-num="${nextVolNum}"]`);
      setState({
        volNum: nextVolNum,
        anchorRect: el?.getBoundingClientRect() ?? null,
        sticky: true,
      });
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, state.volNum, coverMap, hide]);

  // Outside-click dismiss for sticky mode (mobile long-press).
  useEffect(() => {
    if (!visible || !state.sticky || zoomOpen) return;
    const onClick = (e) => {
      // Clicks ON the preview or on a volume thumbnail are handled
      // separately (zoom trigger, re-anchor).
      if (
        e.target.closest("[data-cover-preview]") ||
        e.target.closest("[data-vol-num]")
      ) {
        return;
      }
      hide();
    };
    // Defer one tick so the click that triggered sticky mode doesn't
    // immediately dismiss.
    const id = setTimeout(() => {
      window.addEventListener("click", onClick);
    }, 50);
    return () => {
      clearTimeout(id);
      window.removeEventListener("click", onClick);
    };
  }, [visible, state.sticky, zoomOpen, hide]);

  return {
    visible,
    url,
    volNum: state.volNum,
    anchorRect: state.anchorRect,
    sticky: state.sticky,
    zoomOpen,
    show,
    release,
    hide,
    openZoom: () => setZoomOpen(true),
    closeZoom: () => setZoomOpen(false),
  };
}
