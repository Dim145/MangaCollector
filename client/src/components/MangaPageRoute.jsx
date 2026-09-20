import { Navigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import MangaPage from "@/components/MangaPage.jsx";
import MangaPageSkeleton from "@/components/MangaPageSkeleton.jsx";
import { useLibrary } from "@/hooks/useLibrary.js";
import { refetchLibraryEntry } from "@/lib/sync/outbox.js";

/**
 * 深 · Hydrates the `manga` prop for `/mangapage` so deep links work.
 *
 * Internal navigations push a Manga row in `location.state.manga`.
 * A deep link — a printed QR label, a bookmark, a shared URL, the
 * command palette on a cold tab — carries no state and names the
 * series only by `?mal_id=`.
 *
 * Resolving that id used to mean looking it up in the Dexie-cached
 * library and bouncing to /dashboard when it was absent. Absent has
 * two very different causes, and both bounced:
 *
 *   • the cache is merely *late*. `useLibrary` reads Dexie live and
 *     revalidates over the network; on a device that holds no library
 *     yet, Dexie answers `[]` first, and there is a render where the
 *     network query has settled but the live query has not yet pushed
 *     the rows it just wrote. `isInitialLoad` is false, the row is
 *     missing, and the visitor lands on the dashboard — every time
 *     they open a label's QR code in a fresh browser.
 *   • the row really is not on this device.
 *
 * So absence now asks the server for that one row
 * (`GET /api/user/library/{mal_id}`, via `refetchLibraryEntry`, which
 * writes it into Dexie on the way through) and only redirects once the
 * server has answered that it is not there.
 */
export default function MangaPageRoute({ stateManga, adult_content_level }) {
  const [searchParams] = useSearchParams();
  const malIdParam = searchParams.get("mal_id");
  const malId = malIdParam ? Number.parseInt(malIdParam, 10) : null;
  const hasMalId = Number.isFinite(malId);

  const { data: library, isInitialLoad: libLoading } = useLibrary();
  const resolved = hasMalId
    ? library?.find((m) => m.mal_id === malId)
    : undefined;

  // Only asked when the cached library has settled without the row.
  // `refetchLibraryEntry` returns the entry, or null when the server
  // says it is gone (it answers `[]`, not a 404, for a deleted row).
  const entry = useQuery({
    queryKey: ["library-entry", malId],
    enabled: Boolean(hasMalId && !stateManga && !libLoading && !resolved),
    queryFn: () => refetchLibraryEntry(malId),
    retry: false,
  });

  if (stateManga) {
    return (
      <MangaPage manga={stateManga} adult_content_level={adult_content_level} />
    );
  }

  if (!hasMalId) {
    return <Navigate to="/dashboard" replace />;
  }

  if (resolved) {
    return (
      <MangaPage manga={resolved} adult_content_level={adult_content_level} />
    );
  }

  // Dexie has not answered yet. The skeleton mirrors the hero layout so
  // the swap to real data is a crossfade in place, not a blank → content
  // pop.
  if (libLoading) {
    return <MangaPageSkeleton />;
  }

  // Past this point the single-row query is enabled, so `isPending`
  // means "in flight or about to be" rather than "disabled forever".
  if (entry.isPending || entry.isFetching) {
    return <MangaPageSkeleton />;
  }

  if (entry.data) {
    return (
      <MangaPage
        manga={entry.data}
        adult_content_level={adult_content_level}
      />
    );
  }

  // The server confirmed the series is not in this library — or we are
  // offline and cannot ask. Either way there is nothing to show here.
  return <Navigate to="/dashboard" replace />;
}
