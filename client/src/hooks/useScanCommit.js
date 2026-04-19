import { useCallback } from "react";
import axios from "@/utils/axios.js";
import { useLibrary } from "@/hooks/useLibrary.js";
import { addToUserLibrary } from "@/utils/user.js";
import { getAllVolumesByID, updateVolumeByID } from "@/utils/volume.js";
import { cacheVolumesForManga } from "@/lib/db.js";
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
  const { data: library } = useLibrary();

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

      const mangaData = {
        name: manga.title,
        mal_id: manga.mal_id,
        volumes:
          manga.volumes == null
            ? Math.max(maxVolume, 1)
            : Math.max(manga.volumes, maxVolume),
        volumes_owned: 0,
        image_url_jpg:
          manga.images?.jpg?.large_image_url ||
          manga.images?.jpg?.image_url ||
          null,
        genres: (manga.genres || [])
          .concat(manga.explicit_genres || [])
          .concat(manga.demographics || [])
          .filter((g) => g.type === "manga")
          .map((g) => g.name),
      };

      const existing = library.find((m) => m.mal_id === mangaData.mal_id);
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
        const volPrice =
          priceMode === "all" || num === scanned ? priceNum : 0;
        await updateVolumeByID(target.id, true, volPrice, target.store ?? "");
        newlyOwned.push(num);
      }

      // 4. Refresh + update the library counter
      volumes = await getAllVolumesByID(mangaData.mal_id);
      await cacheVolumesForManga(mangaData.mal_id, volumes);
      const ownedCount = volumes.filter((v) => v.owned).length;
      await updateVolumeOwned(mangaData.mal_id, ownedCount);

      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({ queryKey: ["volumes", mangaData.mal_id] });
      queryClient.invalidateQueries({ queryKey: ["volumes-all"] });

      return {
        added: !alreadyInLibrary,
        newlyOwned,
        alreadyOwned,
        manga: mangaData,
        volumeNumbers: sorted,
      };
    },
    [library]
  );
}
