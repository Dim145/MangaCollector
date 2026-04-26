import { useEffect, useState } from "react";

/**
 * CoverImage — drop-in replacement for a cover `<img>` that falls back
 * to a kanji placeholder when the image 404s, times out, or fails for
 * any other reason.
 *
 * Why this exists: when a user imports a library from an external
 * service, some of the referenced cover URLs can be stale. The old
 * inline pattern (`src ? <img> : <placeholder>`) only checked for the
 * *absence* of a URL — an URL present but dead left a silent broken
 * image that offered no visual handle to click the card and edit the
 * cover through the picker.
 *
 * Behaviour:
 *   • `src` falsy / empty → placeholder immediately.
 *   • `src` present + load succeeds → image rendered normally.
 *   • `src` present + load fails → state flips, placeholder takes over.
 *   • Changing `src` (e.g. after the user picks a new cover via the
 *     CoverPicker) resets the failed flag so the new URL gets a fresh
 *     chance.
 *
 * The placeholder is intentionally the same 巻 motif the app already
 * uses for custom series without cover art, so a failed cover and a
 * never-had-one cover look identical — a quiet, unobtrusive fallback
 * that doesn't signal "something's broken".
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
  // 優先 · `fetchpriority` exposes the HTML standard hint to the
  // browser scheduler. Default `auto` lets the browser decide; pages
  // that paint many covers at once (Dashboard, ShelfStickers, the
  // year-in-review thumb-grid) can pass `"low"` so the first viewport
  // claims the bandwidth and the off-screen rest queues behind it.
  // Above-the-fold hero covers can pass `"high"` to skip the queue.
  fetchPriority = "auto",
  draggable,
}) {
  const [failed, setFailed] = useState(false);

  // Reset the failed flag whenever the source URL changes — a fresh
  // URL deserves a fresh load attempt rather than being pre-marked
  // as broken by a previous one.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const showImg = Boolean(src) && !failed;

  if (showImg) {
    return (
      <img
        src={src}
        alt={alt}
        loading={loading}
        // `decoding="async"` lets the browser rasterise the cover off
        // the main thread — a long list of covers no longer stalls
        // scroll for the few hundred ms it takes to decode each JPEG.
        decoding="async"
        // `fetchpriority` is supported in Chromium 102+, Safari 17.2+,
        // Firefox 132+. Older browsers ignore it gracefully — the
        // attribute name is forwarded as-is so React keeps it on the
        // element regardless. Lower-priority covers wait their turn
        // behind anything tagged `auto` / `high`.
        fetchpriority={fetchPriority}
        draggable={draggable}
        // No-referrer for external CDN compatibility.
        // MangaDex (uploads.mangadex.org) and a couple of other
        // image hosts implement anti-hotlinking by 403'ing requests
        // with a Referer pointing at a domain they don't recognise.
        // Our default Referrer-Policy is `strict-origin-when-cross
        // -origin` (strong default for security), which DOES still
        // send the origin on cross-site image requests. Stripping it
        // entirely on `<img>` tags fixes MangaDex without weakening
        // the page-level policy that protects sensitive nav.
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${className} ${imgClassName} ${blur ? "blur-md" : ""}`.trim()}
      />
    );
  }

  return (
    <div
      aria-hidden={!alt}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-ink-2 to-ink-3 ${fallbackClassName}`}
    >
      <span className="font-display text-4xl italic text-hanko/40 select-none">
        {fallbackKanji}
      </span>
    </div>
  );
}
