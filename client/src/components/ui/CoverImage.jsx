import { useEffect, useState } from "react";

/**
 * Cover `<img>` with a kanji-placeholder fallback when the URL is
 * missing or the load fails. External covers come from MAL / MangaDex
 * and some of those URLs go stale silently after an import.
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
}) {
  const [failed, setFailed] = useState(false);

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
        decoding="async"
        fetchpriority={fetchPriority}
        draggable={draggable}
        // MangaDex and a few other hosts 403 cross-origin requests
        // that carry a Referer they don't recognise; the page-level
        // Referrer-Policy stays strict and only this tag opts out.
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
