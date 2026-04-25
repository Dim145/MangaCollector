import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Floating polaroid-style preview that shows a bigger cover when the user
 * dwells on a thumbnail (hover on desktop, long-press on touch).
 *
 * The appearance:
 *   - 2:3 aspect, up to 60vh tall — plenty big to actually see detail
 *   - Thin washi-cream border + dramatic drop shadow → reads as a physical
 *     photo held in front of a dim stage
 *   - Slight -1° tilt, mirrors the hanko-seal rotations elsewhere
 *   - Enter: fade + translate-up + faint scale-in
 *   - Exit: reverse, shorter duration (snappier dismissal)
 *
 * Positioning — smart proximity:
 *   - Tries right-of-anchor first (most common layout room)
 *   - Falls back to left, then centered if neither side fits
 *   - Always clamped within the viewport with 16px padding
 *
 * The preview never steals pointer events (pointer-events-none on the
 * floating card), so moving the cursor toward the preview while leaving
 * the thumbnail still triggers the dismiss — matches expected tooltip UX.
 */
export default function CoverPreview({
  url,
  anchorRect,
  blur,
  visible,
  sticky = false,
  onClose,
  onZoom,
}) {
  const [mounted, setMounted] = useState(visible);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const id = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, 160);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Dismiss-on-scroll (good citizen: if the user scrolls the page, the
  // anchor moves and the preview would look glued to the wrong spot).
  useEffect(() => {
    if (!visible) return;
    const onScroll = () => onClose?.();
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, [visible, onClose]);

  if (!mounted || !url) return null;
  if (typeof document === "undefined") return null;

  const { top, left } = placement(anchorRect);

  return createPortal(
    <div
      // Sticky mode (mobile long-press) = tappable for zoom.
      // Non-sticky (desktop hover) = pointer-events-none so moving the
      // mouse toward the preview dismisses it (it leaves the thumbnail).
      className={`fixed ${sticky ? "" : "pointer-events-none"}`}
      style={{ top, left, zIndex: 2147483640 }}
      role="img"
      aria-hidden={!sticky}
      data-cover-preview="true"
    >
      <div
        onClick={sticky && onZoom ? onZoom : undefined}
        className={`relative origin-center rounded-sm border border-washi/80 bg-washi p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.6),0_4px_12px_rgba(0,0,0,0.4)] ${
          sticky ? "cursor-zoom-in" : ""
        } ${
          leaving
            ? "animate-cover-preview-out"
            : "animate-cover-preview-in"
        }`}
        style={{ transform: "rotate(-1deg)" }}
      >
        <img referrerPolicy="no-referrer"
          src={url}
          alt=""
          draggable={false}
          // max-h / max-w only — lets the image size itself by its intrinsic
          // aspect ratio. Using fixed h + w-auto + max-w would letterbox and
          // leave empty washi background on the short edge (very visible on
          // narrow mobile screens). This way the polaroid frame hugs the
          // cover precisely.
          className={`block max-h-[min(60vh,480px)] max-w-[min(70vw,360px)] select-none rounded-sm ${
            blur ? "blur-md" : ""
          }`}
        />
        {/* Subtle tape piece at the top — collector vibe */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-2 left-1/2 h-3 w-10 -translate-x-1/2 rotate-2 rounded-[1px] bg-hanko/25 shadow"
        />
      </div>
    </div>,
    document.body,
  );
}

/**
 * Compute the preview's top-left corner. Tries right-of-anchor, then
 * left-of-anchor, then centered above/below, with 16px viewport padding.
 * The anchor is the thumbnail's bounding rect; if null (no rect yet),
 * default to centered screen.
 */
function placement(anchor) {
  const VW = typeof window !== "undefined" ? window.innerWidth : 1024;
  const VH = typeof window !== "undefined" ? window.innerHeight : 768;
  const PAD = 16;
  // Rough preview dimensions for placement math. Actual sizing is capped
  // via CSS, so we under-estimate slightly to stay safe.
  const W = Math.min(360, VW * 0.7);
  const H = Math.min(480, VH * 0.6);
  const GAP = 12;

  if (!anchor) {
    return {
      top: Math.max(PAD, (VH - H) / 2),
      left: Math.max(PAD, (VW - W) / 2),
    };
  }

  // Preferred: right of anchor, vertically aligned near it
  const rightLeft = anchor.right + GAP;
  if (rightLeft + W + PAD <= VW) {
    return {
      top: clampTop(anchor.top + anchor.height / 2 - H / 2, VH, H),
      left: rightLeft,
    };
  }
  // Fallback: left of anchor
  const leftLeft = anchor.left - GAP - W;
  if (leftLeft - PAD >= 0) {
    return {
      top: clampTop(anchor.top + anchor.height / 2 - H / 2, VH, H),
      left: leftLeft,
    };
  }
  // Last resort: centered above the anchor if there's vertical room,
  // else below, else just viewport-centered.
  const aboveTop = anchor.top - GAP - H;
  if (aboveTop - PAD >= 0) {
    return { top: aboveTop, left: clampLeft(anchor.left + anchor.width / 2 - W / 2, VW, W) };
  }
  const belowTop = anchor.bottom + GAP;
  if (belowTop + H + PAD <= VH) {
    return { top: belowTop, left: clampLeft(anchor.left + anchor.width / 2 - W / 2, VW, W) };
  }
  return {
    top: Math.max(PAD, (VH - H) / 2),
    left: Math.max(PAD, (VW - W) / 2),
  };
}

function clampTop(t, VH, H) {
  const PAD = 16;
  return Math.max(PAD, Math.min(VH - H - PAD, t));
}
function clampLeft(l, VW, W) {
  const PAD = 16;
  return Math.max(PAD, Math.min(VW - W - PAD, l));
}
