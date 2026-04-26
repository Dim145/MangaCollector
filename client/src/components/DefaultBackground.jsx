import SeasonAtmosphere from "./SeasonAtmosphere.jsx";

export default function DefaultBackground({ children }) {
  return (
    <div className="relative isolate grain min-h-[calc(100svh-4rem)] overflow-hidden">
      {/* 季節 · Ambient season layer.
          Renders behind every other background detail — sits between
          the page colour and the radial gradients, so the gradients
          and the grain texture continue to do their work over the
          drifting particles. The component self-mutes when the user
          has `prefers-reduced-motion: reduce`, so vestibular-sensitive
          users see the same chrome as today. */}
      <SeasonAtmosphere />

      {/* Ambient radial gradients — colours resolve from theme tokens so
          light mode gets pastel hints, dark mode keeps the deep hanko glow. */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden="true"
      >
        <div
          className="absolute -top-40 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, var(--scene-red), transparent 70%)",
          }}
        />
        <div
          className="absolute bottom-0 right-0 h-[30rem] w-[30rem] rounded-full opacity-30 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, var(--scene-gold), transparent 70%)",
          }}
        />
        <div
          className="absolute top-1/3 -left-20 h-[20rem] w-[20rem] rounded-full opacity-20 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, var(--scene-sakura), transparent 70%)",
          }}
        />
      </div>

      {/* Fine grid — uses text colour so it's a faint ink line in light,
          faint cream line in dark. */}
      <svg
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full text-washi opacity-[0.04]"
        aria-hidden="true"
      >
        <defs>
          <pattern
            id="bg-grid"
            width="48"
            height="48"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 48 0 L 0 0 0 48"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.6"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#bg-grid)" />
      </svg>

      {/* Vignette — dark ring in dark mode, invisible on white page. */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 100% 70% at 50% 0%, transparent, var(--scene-vignette) 100%)",
        }}
      />

      {/* Content */}
      <div className="relative">{children}</div>
    </div>
  );
}
