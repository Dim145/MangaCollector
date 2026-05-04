import DefaultBackground from "./DefaultBackground.jsx";
import Skeleton from "./ui/Skeleton.jsx";

/**
 * Skeleton hero shown during the brief Dexie-hydration gap when a
 * user lands on `/mangapage?mal_id=X` via deep link / refresh /
 * QR scan. Internal SPA navigations push the manga in
 * `location.state` and skip this entirely.
 *
 * The shape mirrors `MangaPage`'s hero layout (cover + title +
 * meta line + chip row) so the swap from skeleton → real data is a
 * crossfade-in-place rather than a layout shift. Volumes grid
 * placeholder is intentionally omitted — `useVolumesForManga()`
 * already renders its own `Skeleton.Card` row inside MangaPage.
 */
export default function MangaPageSkeleton() {
  return (
    <DefaultBackground>
      <div className="mx-auto max-w-6xl px-4 pt-4 pb-nav md:pb-16 sm:px-6 md:pt-10">
        {/* Back link placeholder — narrower so it reads as a chip,
            not a content row */}
        <Skeleton className="mb-6 h-3 w-24 rounded" />

        <section className="relative mb-8">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] md:gap-10">
            {/* Cover */}
            <div className="mx-auto w-full max-w-[220px] md:mx-0 md:max-w-none">
              <div className="relative aspect-[2/3] overflow-hidden rounded-2xl border border-border shadow-2xl">
                <Skeleton className="absolute inset-0 h-full w-full rounded-2xl" />
              </div>
            </div>

            {/* Title + meta column */}
            <div className="flex flex-col">
              {/* Eyebrow */}
              <Skeleton className="h-3 w-32 rounded" />
              {/* Title — two lines worth of space so a long title
                  doesn't push the rest down on resolve */}
              <Skeleton className="mt-3 h-8 w-3/4 rounded" />
              <Skeleton className="mt-2 h-8 w-1/2 rounded" />

              {/* Meta line: completion + count */}
              <div className="mt-6 flex items-center gap-3">
                <Skeleton className="h-4 w-24 rounded" />
                <span className="h-px flex-1 bg-border" />
                <Skeleton className="h-4 w-16 rounded" />
              </div>

              {/* Genres chips */}
              <div className="mt-5 flex flex-wrap gap-1.5">
                {[14, 18, 12, 16, 14].map((w, i) => (
                  <Skeleton
                    key={i}
                    className="h-5 rounded-full"
                    style={{ width: `${w * 6}px`, animationDelay: `${i * 60}ms` }}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Stat strip — three cards mirroring SummaryCard layout */}
        <section className="mb-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-border bg-ink-1/50 p-5 backdrop-blur"
            >
              <Skeleton className="h-3 w-20 rounded" />
              <Skeleton className="mt-2 h-8 w-16 rounded" />
              <Skeleton className="mt-2 h-3 w-32 rounded" />
            </div>
          ))}
        </section>

        {/* Volume grid placeholder — small tiles in the same column
            count as the real ledger view so the grid doesn't pop into
            existence one row at a time. The aspect-ratio reservation
            comes from the explicit `aspect-[2/3]` class so each tile
            sizes to its slot the same way the real <Volume> tiles do. */}
        <section
          aria-hidden="true"
          className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8"
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton
              key={i}
              className="aspect-[2/3] w-full rounded-md"
              // Wave the shimmer phase across the row so the grid
              // doesn't pulse in lockstep — matches the per-tile
              // stagger we use elsewhere.
              style={{ animationDelay: `${(i % 6) * 70}ms` }}
            />
          ))}
        </section>
      </div>
    </DefaultBackground>
  );
}
