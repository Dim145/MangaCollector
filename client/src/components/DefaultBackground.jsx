export default function DefaultBackground({ children }) {
  return (
    <div className="relative isolate grain min-h-[calc(100svh-4rem)] overflow-hidden">
      {/* Ambient radial gradients */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden="true"
      >
        <div
          className="absolute -top-40 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, oklch(0.6 0.22 25 / 0.35), transparent 70%)",
          }}
        />
        <div
          className="absolute bottom-0 right-0 h-[30rem] w-[30rem] rounded-full opacity-30 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, oklch(0.82 0.13 78 / 0.25), transparent 70%)",
          }}
        />
        <div
          className="absolute top-1/3 -left-20 h-[20rem] w-[20rem] rounded-full opacity-20 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, oklch(0.82 0.07 12 / 0.4), transparent 70%)",
          }}
        />
      </div>

      {/* Fine grid */}
      <svg
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-[0.04]"
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

      {/* Vignette */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 100% 70% at 50% 0%, transparent, oklch(0.08 0.005 30 / 0.8) 100%)",
        }}
      />

      {/* Content */}
      <div className="relative">{children}</div>
    </div>
  );
}
