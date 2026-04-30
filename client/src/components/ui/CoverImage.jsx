import { useEffect, useState } from "react";
import { coverPaletteFor } from "@/lib/coverPalette.js";

/**
 * Cover `<img>` with a kanji-placeholder fallback when the URL is
 * missing or the load fails. External covers come from MAL / MangaDex
 * and some of those URLs go stale silently after an import.
 *
 * 軽 · LQIP — `paletteSeed` (typically the manga's `mal_id`) drives a
 * deterministic Shōjo-Noir-tinted background colour that fills the
 * slot while the cover is being fetched. The actual `<img>` fades in
 * on load so the swap from swatch → photo is continuous instead of a
 * "blank → flash" transition. Falls back to the existing `bg-ink-2`
 * gradient when no seed is provided.
 */
export default function CoverImage({
  src,
  alt = "",
  blur = false,
  className = "",
  imgClassName = "",
  fallbackKanji = "巻",
  fallbackClassName = "",
  loading = "lazy",
  fetchPriority = "auto",
  draggable,
  paletteSeed,
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

  const showImg = Boolean(src) && !failed;
  const placeholderColor =
    paletteSeed != null ? coverPaletteFor(paletteSeed) : null;

  if (showImg) {
    return (
      <span
        // `relative block h-full w-full` is the baseline so the span
        // always fills its container (callers wrap us in an
        // aspect-ratio box and expect the slot to be filled). Caller-
        // supplied `className` is merged after — Tailwind dedupes
        // duplicates and any explicit override takes precedence.
        className={`relative block h-full w-full ${className}`.trim()}
        style={{
          backgroundColor: placeholderColor ?? undefined,
          // Smooth the colour-swatch → image hand-off when the
          // browser eventually paints the photo. Skipped if we have
          // no seed (no swatch behind the image to fade out from).
          transition: placeholderColor
            ? "background-color 200ms ease"
            : undefined,
        }}
      >
        <img
          src={src}
          alt={alt}
          loading={loading}
          decoding="async"
          fetchpriority={fetchPriority}
          draggable={draggable}
          // MangaDex and a few other hosts 403 cross-origin requests
          // that carry a Referer they don't recognise; the page-level
          // Referrer-Policy stays strict and only this tag opts out.
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          onLoad={() => setLoaded(true)}
          className={`${imgClassName} ${blur ? "blur-md" : ""} ${
            placeholderColor ? "transition-opacity duration-300" : ""
          } ${placeholderColor && !loaded ? "opacity-0" : "opacity-100"}`.trim()}
        />
      </span>
    );
  }

  return (
    <div
      aria-hidden={!alt}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      className={`flex h-full w-full items-center justify-center ${
        placeholderColor ? "" : "bg-gradient-to-br from-ink-2 to-ink-3"
      } ${fallbackClassName}`}
      style={
        placeholderColor ? { backgroundColor: placeholderColor } : undefined
      }
    >
      <span className="font-display text-4xl italic text-hanko/40 select-none">
        {fallbackKanji}
      </span>
    </div>
  );
}
