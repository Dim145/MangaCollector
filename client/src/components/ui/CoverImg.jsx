import { useState } from "react";
import { coverSources } from "@/lib/covers.js";

/**
 * 寸 · A plain `<img>` for a cover, with the cover's renditions.
 *
 * For the places that draw a cover as a bare image — the series hero,
 * the ledger's thumbnails, the drawer, the calendar — where the slot is
 * styled on the `<img>` itself and `CoverImage`'s wrapper would not fit.
 * Every other prop goes to the `<img>` unchanged.
 *
 * `sizes` is the slot's drawn width (see `CoverImage`); with it, a
 * 40-pixel thumbnail asks MangaDex for its 256-pixel rendition instead
 * of the original file, which is what a volume's cover is stored as.
 * The request goes to the CDN as it always did from these places (the
 * operator's relay is `CoverImage`'s business). If a rendition fails,
 * the image falls back to the address exactly as stored, then to the
 * caller's own `onError`.
 */
export default function CoverImg({ src, sizes = "200px", onError, ...rest }) {
  const [plainFor, setPlainFor] = useState(null);
  const plain = plainFor === src;
  const sources = plain ? { src, srcSet: undefined } : coverSources(src, { relay: false });
  return (
    <img
      {...rest}
      srcSet={sources.srcSet}
      sizes={sources.srcSet ? sizes : undefined}
      src={sources.src}
      onError={(event) => {
        if (!plain && sources.srcSet) {
          setPlainFor(src);
          return;
        }
        onError?.(event);
      }}
    />
  );
}
