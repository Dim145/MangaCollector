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
        draggable={draggable}
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
