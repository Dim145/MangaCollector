import { useCallback } from "react";
import axios from "@/utils/axios.js";
import { addToUserLibrary } from "@/utils/user.js";
import { getAllVolumesByID, updateVolumeByID } from "@/utils/volume.js";
import { cacheVolumesForManga, db } from "@/lib/db.js";
import { updateVolumeOwned } from "@/utils/library.js";
import { queryClient } from "@/lib/queryClient.js";

/**
 * Commit one or more scanned volumes for a series in a single flow:
 *
 *   - add the series to the library if missing
 *   - bump the server-side total-volumes count if the highest target
 *     exceeds it (otherwise the volume row won't exist yet)
 *   - mark each target volume as owned
 *   - refresh the mirror cache and the library.volumes_owned counter
 *
 * `volumeNumbers` is an array — single-scan passes `[N]`, gap-fill passes
 * `[missingA, missingB, ..., scannedN]`.
 *
 * Online-only (volume ids are server-generated; Google Books needs the net
 * anyway).
 */
export function useScanCommit() {
  // Intentionally NOT using `useLibrary()` here: `useLibrary` returns
  // the TanStack Query snapshot at the moment the hook runs, which
  // gets captured by useCallback's closure. On the first scan after
  // app start, Dexie may still be loading — the snapshot is `[]` and
  // every scanned series is treated as "new", re-POSTed, and the
  // server 409s because the series already exists. Re-reading the
  // live Dexie rows inside the callback guarantees we always make
  // decisions from the current state of the local mirror, regardless
  // of React render timing.
  return useCallback(
    async ({
      manga,
      volumeNumbers,
      scannedVolume,
      price = 0,
      // 'scanned' (default): price applied only to `scannedVolume` (barcode flow)
      // 'all'              : price applied to every volume in `volumeNumbers`
      //                      (recommendation flow — "I paid X per volume")
      priceMode = "scanned",
    }) => {
      if (!Array.isArray(volumeNumbers) || volumeNumbers.length === 0) {
        throw new Error("No volume numbers to commit");
      }
      const sorted = [...volumeNumbers].sort((a, b) => a - b);
      const maxVolume = sorted[sorted.length - 1];
      if (maxVolume < 1) throw new Error("Invalid volume number");

      const scanned = scannedVolume ?? maxVolume;
      const priceNum = Number(price) || 0;

      // Accept both the legacy Jikan shape (manga.title, manga.images.jpg…)
      // and the new unified shape (manga.name, manga.image_url, flat genres).
      // The scan flow still passes the first MAL candidate so both can happen.
      const resolvedName = manga.name ?? manga.title;
      const resolvedImage =
        manga.image_url ??
        manga.images?.jpg?.large_image_url ??
        manga.images?.jpg?.image_url ??
        null;
      const resolvedGenres = Array.isArray(manga.genres)
        ? manga.genres
            .map((g) => (typeof g === "string" ? g : g?.name))
            .filter(Boolean)
        : [];

      const mangaData = {
        name: resolvedName,
        mal_id: manga.mal_id,
        volumes:
          manga.volumes == null
            ? Math.max(maxVolume, 1)
            : Math.max(manga.volumes, maxVolume),
        volumes_owned: 0,
        image_url_jpg: resolvedImage,
        genres: resolvedGenres,
        mangadex_id: manga.mangadex_id ?? null,
      };

      // Live read from Dexie at call time — see the useCallback
      // comment above for why we don't use the React snapshot.
      const existing = await db.library
        .where("mal_id")
        .equals(mangaData.mal_id)
        .first();
      const alreadyInLibrary = Boolean(existing);

      // 1. Add series if new
      if (!alreadyInLibrary) {
        await addToUserLibrary(mangaData);
      } else if ((existing.volumes ?? 0) < maxVolume) {
        // Bump total so the target volume row exists server-side
        await axios.patch(`/api/user/library/${mangaData.mal_id}`, {
          volumes: maxVolume,
        });
      }

      // 2. Fetch volumes (IDs assigned server-side)
      let volumes = await getAllVolumesByID(mangaData.mal_id);
      await cacheVolumesForManga(mangaData.mal_id, volumes);

      // 3. Mark each target vol as owned — skip any that were already owned.
      // The scanned volume gets the price the user confirmed; gap-fill
      // volumes stay at 0 (the user didn't tell us what those cost).
      const newlyOwned = [];
      const alreadyOwned = [];
      for (const num of sorted) {
        const target = volumes.find((v) => v.vol_num === num);
        if (!target) {
          throw new Error(`Volume ${num} not found on server after add`);
        }
        if (target.owned) {
          alreadyOwned.push(num);
          continue;
        }
        const volPrice = priceMode === "all" || num === scanned ? priceNum : 0;
        await updateVolumeByID(target.id, true, volPrice, target.store ?? "");
        newlyOwned.push(num);
      }

      // 4. Refresh + update the library counter
      volumes = await getAllVolumesByID(mangaData.mal_id);
      await cacheVolumesForManga(mangaData.mal_id, volumes);
      const ownedCount = volumes.filter((v) => v.owned).length;
      await updateVolumeOwned(mangaData.mal_id, ownedCount);

      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({
        queryKey: ["volumes", mangaData.mal_id],
      });
      queryClient.invalidateQueries({ queryKey: ["volumes-all"] });

      return {
        added: !alreadyInLibrary,
        newlyOwned,
        alreadyOwned,
        manga: mangaData,
        volumeNumbers: sorted,
      };
    },
    // Empty deps: we no longer close over anything that changes between
    // renders — `db` is a module-level singleton, every other imported
    // function is pure. Re-creating the callback on every render would
    // just thrash downstream `useMemo`/`useEffect` hooks for nothing.
    [],
  );
}
