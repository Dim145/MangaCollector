import chibiUrl from "@/assets/chibi-archivist.svg";

/**
 * 迷子 Maigo · Chibi mascot for the 404 page.
 *
 * The illustration itself is a CC0 / public-domain chibi
 * anime artwork from the Open Clip Art Library, by stilg4r,
 * via Wikimedia Commons. Loaded as a static asset (Vite URL
 * import) rather than inlined into JSX:
 *
 *   • The source is ~70 KB of detailed Inkscape paths +
 *     Gaussian-blur filters that give the character soft,
 *     hand-drawn shading. Inlining that in the bundle would
 *     bloat the route's JS chunk; serving as a separate
 *     asset lets the browser cache it independently and
 *     keeps the React tree lean.
 *   • As an `<img>`, the SVG renders crisp at any size and
 *     can't accidentally pollute the document's id /
 *     filter / gradient namespaces.
 *
 * Composition over the static character
 * -------------------------------------
 * The illustration is wrapped in a `chibi-archivist` block
 * that adds three React-driven layers on top:
 *
 *   • `chibi-bob` — gently bobs the whole image vertically
 *     so the mascot reads as alive rather than a static
 *     poster. 2.4 s loop, ±6 px.
 *   • Three floating `?` glyphs — each on its own animation
 *     phase (offset 0 / 0.5 / 1 s) so they don't bob in
 *     lockstep. Painted in hanko cinnabar + gold, sized
 *     11/16/22 px so the eye catches the cluster as
 *     "confusion" rather than three identical marks.
 *   • A sweat drop — slides down the right side of the
 *     panel and fades, the universal anime cue for
 *     awkwardness. Loops every 3 s with a 0.5 s offset
 *     against the bob.
 *
 * Reduced motion
 * --------------
 * All three animations collapse to no-op under
 * `prefers-reduced-motion: reduce` (see styles/index.css).
 * The mascot still renders fully — the only thing the
 * user loses is the loop motion.
 *
 * License attribution
 * -------------------
 * The source SVG is in the public domain (CC0 1.0
 * Universal Public Domain Dedication via Open Clip Art
 * Library). No attribution is legally required, but the
 * file metadata inside the SVG preserves the original
 * author's name (stilg4r, 2012) for posterity.
 */
export default function ChibiArchivist({ className = "" }) {
  return (
    <div
      className={`chibi-archivist relative inline-flex items-center justify-center ${className}`}
      aria-hidden="true"
    >
      {/* The character itself — bobs as a unit. The
          intrinsic aspect ratio of the source is roughly
          0.8 (352 / 443), so we let height drive layout
          and width auto-fit. */}
      <img
        src={chibiUrl}
        alt=""
        className="chibi-bob h-full w-auto select-none"
        draggable={false}
      />

      {/* 汗 · Sweat drop — absolutely positioned at the
          temple area of the chibi. The percentages assume
          the source SVG's standard layout (head occupies
          the top ~45% of the canvas, slightly right of
          centre). Tweaking these values is what tunes the
          "right next to the cheek" placement. */}
      <span
        className="chibi-sweat pointer-events-none absolute"
        style={{
          top: "18%",
          right: "12%",
          width: "0.7rem",
          height: "1.1rem",
        }}
      >
        <svg viewBox="0 0 14 22" className="h-full w-full">
          <path
            d="M 7 3 Q 3 11 3 15 Q 3 19 7 19 Q 11 19 11 15 Q 11 11 7 3 Z"
            fill="#9DD9F2"
            stroke="#5A9DDB"
            strokeWidth="1.1"
          />
        </svg>
      </span>

      {/* ？· Floating question marks at three sizes / three
          phases. Positioned absolutely around the chibi so
          they read as thought-bubbles in the user's head
          rather than props the character is holding. */}
      <span
        className="chibi-q chibi-q1 pointer-events-none absolute font-jp font-extrabold"
        style={{
          top: "4%",
          right: "0%",
          color: "var(--hanko)",
          fontSize: "1.5rem",
        }}
      >
        ?
      </span>
      <span
        className="chibi-q chibi-q2 pointer-events-none absolute font-jp font-extrabold"
        style={{
          top: "10%",
          left: "2%",
          color: "var(--hanko)",
          opacity: 0.75,
          fontSize: "1.05rem",
        }}
      >
        ?
      </span>
      <span
        className="chibi-q chibi-q3 pointer-events-none absolute font-jp font-extrabold"
        style={{
          top: "30%",
          left: "-2%",
          color: "var(--gold)",
          opacity: 0.75,
          fontSize: "0.7rem",
        }}
      >
        ?
      </span>
    </div>
  );
}
