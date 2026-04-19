import { useEffect, useState } from "react";

/*
 * Cold-start hero loader. Only shown when we truly have nothing to paint
 * yet — Dexie empty + network fetch in flight for first-ever visit.
 *
 * After 3 s, morphs into a softer "still working" state so the screen
 * never feels frozen.
 */
export default function PageLoader({
  message = "Preparing your archive",
  kanji = "読",
  fullscreen = false,
}) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        fullscreen
          ? "fixed inset-0 isolate grain"
          : "relative isolate grain min-h-[60vh]"
      }
      style={
        fullscreen
          ? {
              zIndex: 50,
              background:
                "radial-gradient(ellipse at 50% 50%, var(--bg-glow-red), transparent 65%), var(--background)",
            }
          : undefined
      }
    >
      <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-5 px-6 text-center">
        <div className="relative">
          <div
            className="absolute inset-0 animate-ping rounded-lg bg-hanko/25"
            style={{ animationDuration: "1.8s" }}
          />
          <span
            className="hanko-seal relative grid h-20 w-20 place-items-center rounded-lg font-display text-3xl font-bold animate-pulse-glow"
            aria-hidden="true"
          >
            {kanji}
          </span>
        </div>

        <div className="max-w-sm space-y-1.5">
          <p className="font-display text-xl italic text-washi">
            {message}
            <span className="inline-block w-[1.5ch] text-left">
              <DotsEllipsis />
            </span>
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
            {slow ? "Taking a bit longer than usual…" : "A single moment"}
          </p>
        </div>

        {/* Three progress dashes that fill sequentially — echoes kuyou panels */}
        <div className="mt-2 flex items-center gap-1.5">
          <Dash index={0} />
          <Dash index={1} />
          <Dash index={2} />
        </div>
      </div>
    </div>
  );
}

function Dash({ index }) {
  return (
    <span
      className="block h-0.5 w-8 overflow-hidden rounded-full bg-washi/15"
      style={{ animationDelay: `${index * 220}ms` }}
    >
      <span
        className="block h-full w-full origin-left bg-hanko"
        style={{
          animation: `dash-fill 1.6s ${index * 180}ms infinite cubic-bezier(0.6,0.1,0.2,1)`,
        }}
      />
    </span>
  );
}

function DotsEllipsis() {
  // Animated three-dot ellipsis that rolls in
  return (
    <span className="inline-flex">
      <span
        className="inline-block"
        style={{ animation: "dots-roll 1.4s infinite", animationDelay: "0ms" }}
      >
        .
      </span>
      <span
        className="inline-block"
        style={{ animation: "dots-roll 1.4s infinite", animationDelay: "160ms" }}
      >
        .
      </span>
      <span
        className="inline-block"
        style={{ animation: "dots-roll 1.4s infinite", animationDelay: "320ms" }}
      >
        .
      </span>
    </span>
  );
}
