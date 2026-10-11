import { useMemo, useState } from "react";
import { useLazyImage } from "@/hooks/useLazyImage.js";
import { coverPaletteFor } from "@/lib/coverPalette.js";
import { coverSources, isProxiedCover } from "@/lib/covers.js";
import { rememberLcpCover } from "@/lib/lcpHints.js";
import { hasSeenCover, rememberSeenCover } from "@/lib/seenCovers.js";

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
 *
 * 寸 · `sizes` is how wide the slot is drawn, in the `<img sizes>`
 * syntax. With it the browser picks the cover's smallest rendition that
 * still fills the slot at the screen's density (`lib/covers.js` lists
 * them) — a 28-pixel thumbnail no longer downloads the 213 kB cover the
 * series page shows. The default is a grid tile's width, which picks
 * what was always picked on a dense screen, so a caller that forgets
 * to pass it costs nothing it did not cost before.
 *
 * 先 · `priority` is for the covers a page opens on — the first row of
 * the shelf, the largest image of the screen. They skip the lazy
 * observer, load eagerly and ask for high fetch priority, so the request
 * starts with the first commit instead of waiting for a frame.
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
  priority = false,
  // 先 · Rank among the covers this page opens on, for the next visit's
  // preload (`lib/lcpHints.js`). Only the callers that know their first
  // covers are the same on every arrival pass it.
  lcpHintRank,
  sizes = "200px",
  draggable,
  paletteSeed,
  // 寸 · Intrinsic dimensions — used for `width` / `height`
  // attributes on the `<img>`. Modern browsers derive an
  // `aspect-ratio` from these even when CSS sizes the element
  // with `h-full w-full`, which prevents the layout shift that
  // would otherwise happen between the slot allocation and the
  // first decoded frame. Defaults to 200×300 (the canonical
  // 2:3 manga cover ratio); avatar / non-cover callers can
  // override with their own ratio (e.g. 1:1 for square avatars).
  width = 200,
  height = 300,
}) {
  // 影 · Where the request goes, in three steps. Stage 0 is what the
  // operator chose: the relay when it is on (`lib/covers.js`), else the
  // CDN — with the cover's renditions in `srcset` either way. A failure
  // there falls back to the CDN's renditions (stage 1, skipped when the
  // relay was not in play), then to the address exactly as stored
  // (stage 2) — a host that lacks a rendition must cost a retry, never
  // a hole in the shelf. Reset whenever `src` changes, during render, so
  // a recycled tile never paints the previous series for a frame.
  // 既 · Drawn before in this page's life: at once, no fade
  // (`lib/seenCovers.js`).
  const seen = hasSeenCover(src);
  const [state, setState] = useState({ src, stage: 0, failed: false, loaded: seen });
  if (state.src !== src) {
    setState({ src, stage: 0, failed: false, loaded: seen });
  }
  const { stage, failed, loaded } = state.src === src ? state : { stage: 0, failed: false, loaded: seen };

  const sources = useMemo(() => {
    if (stage === 0) return coverSources(src, { relay: true });
    if (stage === 1) return coverSources(src, { relay: false });
    return { src, srcSet: undefined };
  }, [src, stage]);

  // 遅 · Defer the actual `<img>` mount until the slot approaches the
  // viewport (200px buffer). Skips the network request entirely for
  // off-screen slots in a virtualized grid; the LQIP swatch fills the
  // visible space until then. Priority covers are needed now, and a
  // cover already drawn costs no request.
  const { ref: lazyRef, near } = useLazyImage({ enabled: !priority && !seen });

  const onError = () => {
    setState((prev) => {
      if (prev.src !== src) return prev;
      if (prev.stage === 0 && isProxiedCover(sources.src)) {
        return { ...prev, stage: 1 };
      }
      if (prev.stage < 2 && sources.srcSet) {
        return { ...prev, stage: 2 };
      }
      return { ...prev, failed: true };
    });
  };
  const onLoad = () => {
    setState((prev) => (prev.src === src && !prev.loaded ? { ...prev, loaded: true } : prev));
    // Only a load at the first stage: a cover that needed a fallback
    // starts its chain over next time, as it did.
    if (stage === 0) rememberSeenCover(src);
    if (lcpHintRank != null && typeof window !== "undefined") {
      rememberLcpCover(window.location.pathname, lcpHintRank, {
        src: sources.src,
        srcset: sources.srcSet,
        sizes: sources.srcSet ? sizes : undefined,
      });
    }
  };

  const showImg = Boolean(src) && !failed;
  const placeholderColor =
    paletteSeed != null ? coverPaletteFor(paletteSeed) : null;

  if (showImg) {
    return (
      <span
        ref={lazyRef}
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
        {near && (
          <img
            // `srcSet`/`sizes` before `src`: browsers that evaluate the
            // attributes in order must see the candidates before they
            // start fetching `src`.
            srcSet={sources.srcSet}
            sizes={sources.srcSet ? sizes : undefined}
            src={sources.src}
            alt={alt}
            // 寸 · Intrinsic width/height attributes set the
            // `aspect-ratio` the browser uses to reserve the
            // image's slot before bytes arrive. Without them,
            // a grid of 200 covers can trigger cascading
            // layouts as each one decodes (≈30–50 ms on a
            // mid-range mobile). The CSS sizing utilities
            // (`h-full w-full object-cover` etc. via
            // `imgClassName`) still drive the actual rendered
            // dimensions.
            width={width}
            height={height}
            // Native `loading="lazy"` stays as a safety net — on the
            // off-chance our IntersectionObserver fires too early
            // (e.g. extreme `rootMargin` accidents) the browser still
            // defers the fetch until the slot is genuinely close to
            // the viewport.
            loading={priority || seen ? "eager" : loading}
            // A cover drawn before is decoded with the frame that shows
            // it: the browser drops decoded pixels with the element, and
            // decoded apart ("async") a library coming back from a
            // series showed its covers as holes for two or three frames.
            decoding={seen ? "sync" : priority ? "auto" : "async"}
            fetchPriority={priority ? "high" : fetchPriority}
            draggable={draggable}
            // MangaDex and a few other hosts 403 cross-origin requests
            // that carry a Referer they don't recognise; the page-level
            // Referrer-Policy stays strict and only this tag opts out.
            referrerPolicy="no-referrer"
            onError={onError}
            onLoad={onLoad}
            className={`${imgClassName} ${blur ? "blur-md" : ""} ${
              placeholderColor ? "transition-opacity duration-300" : ""
            } ${placeholderColor && !loaded ? "opacity-0" : "opacity-100"}`.trim()}
          />
        )}
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
      <span className="font-display text-4xl italic text-hanko-bright/40 select-none">
        {fallbackKanji}
      </span>
    </div>
  );
}
