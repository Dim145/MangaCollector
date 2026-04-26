import { Component } from "react";

/**
 * 災 · Route-level error boundary.
 *
 * Catches the two failure modes that bypass `<Suspense>`'s normal
 * fallback rendering and would otherwise crash the entire SPA into a
 * blank white screen:
 *
 *   1. **Chunk-load failure.** A lazy-loaded route's JS bundle 404s or
 *      stalls — common in PWAs after a deploy invalidates old chunks
 *      while the user has a stale tab open, or on flaky offline-first
 *      networks. React's <Suspense> can't react to a `Promise.reject`
 *      from `import()`; without a boundary the error propagates up and
 *      kills the tree.
 *
 *   2. **Runtime crash inside a route.** Genuine bugs in lazily-loaded
 *      pages (Profile's chart code, for instance) get caught here so a
 *      ProfilePage explosion doesn't take Dashboard down with it.
 *
 * The visual treatment matches the rest of the app's "something went
 * wrong, hold on" pattern (the unknown-state panel in ProtectedRoute,
 * the offline banner) — hanko-red ink, kanji eyebrow, refined-minimal
 * card. We don't try to recover programmatically; the chunk that
 * failed is gone for this page lifetime, and the cleanest way to get
 * a fresh module graph is a hard reload. The Retry button does
 * exactly that.
 *
 * Class component because hooks have no equivalent of
 * `componentDidCatch` / `getDerivedStateFromError` as of React 19 —
 * the boundary feature is intentionally still class-only.
 */
export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface to the console for ops; don't ship to a logger we don't
    // have. The user-facing panel below is enough for end-users.
    console.error("[RouteErrorBoundary]", error, info?.componentStack);
  }

  reset = () => {
    // Hard-reload so a chunk-load failure has a chance to re-fetch
    // from a fresh module graph. A `setState({ error: null })` would
    // simply re-render the same broken lazy import.
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    // Detect the chunk-load class of error specifically — the message
    // format is "Failed to fetch dynamically imported module" in
    // Chromium, "error loading dynamically imported module" in Firefox.
    const message = String(this.state.error?.message ?? "");
    const isChunkError =
      /dynamically imported module|Loading chunk|ChunkLoadError/i.test(
        message,
      );

    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <span
          aria-hidden
          className="hanko-seal grid h-14 w-14 place-items-center rounded-lg font-display text-base font-bold animate-pulse-glow"
        >
          災
        </span>
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko">
          {isChunkError ? "OFFLINE · 通信" : "ERROR · 災"}
        </p>
        <h1 className="font-display text-2xl font-light italic text-washi md:text-3xl">
          {isChunkError
            ? "This section couldn't load"
            : "Something broke in this view"}
        </h1>
        <p className="max-w-md text-sm text-washi-muted">
          {isChunkError
            ? "MangaCollector tried to download the page's code but the network or cache turned the request away. A fresh load almost always fixes it."
            : "An unexpected error stopped this view from rendering. Reloading the app rebuilds its state from a clean slate."}
        </p>
        <button
          type="button"
          onClick={this.reset}
          className="mt-2 rounded-full border border-hanko/40 bg-hanko/10 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-washi transition hover:border-hanko hover:bg-hanko hover:text-washi"
        >
          Reload
        </button>
      </div>
    );
  }
}
