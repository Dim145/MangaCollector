import { useCallback } from "react";
import axios from "@/utils/axios.js";
import { useLibrary } from "@/hooks/useLibrary.js";
import { addToUserLibrary } from "@/utils/user.js";
import { getAllVolumesByID, updateVolumeByID } from "@/utils/volume.js";
import { cacheVolumesForManga } from "@/lib/db.js";
import { updateVolumeOwned } from "@/utils/library.js";
import { queryClient } from "@/lib/queryClient.js";

/**
 * Commit a scanned volume: add the manga to the library if missing, then
 * mark the specific volume as owned.
 *
 * This path is online-only because:
 *   - volumes are created server-side at library-add time (their ids are
 *     server-assigned), and we need those ids to PATCH a specific one
 *   - Google Books / MAL lookups happen online anyway
 *
 * The AddPage guards the "Scan" button behind `useOnline` so users get a
 * clear message instead of a silent failure.
 */
export function useScanCommit() {
  const { data: library } = useLibrary();

  return useCallback(
    async ({ manga, volumeNumber }) => {
      if (!volumeNumber || volumeNumber < 1) {
        throw new Error("Missing volume number");
      }

      const mangaData = {
        name: manga.title,
        mal_id: manga.mal_id,
        volumes:
          manga.volumes == null
            ? Math.max(volumeNumber, 1)
            : manga.volumes,
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

      const alreadyInLibrary = library.some(
        (m) => m.mal_id === mangaData.mal_id
      );

      // 1. Add the series if it's new
      if (!alreadyInLibrary) {
        await addToUserLibrary(mangaData);
      } else if ((library.find((m) => m.mal_id === mangaData.mal_id)
        ?.volumes ?? 0) < volumeNumber) {
        // Existing series but our total is less than the volume we just
        // scanned → bump the total so the volume record gets created.
        await axios.patch(`/api/user/library/${mangaData.mal_id}`, {
          volumes: volumeNumber,
        });
      }

      // 2. Fetch the freshly created / existing volumes
      const volumes = await getAllVolumesByID(mangaData.mal_id);
      await cacheVolumesForManga(mangaData.mal_id, volumes);

      const target = volumes.find((v) => v.vol_num === volumeNumber);
      if (!target) {
        throw new Error(
          `Volume ${volumeNumber} not found on server after add`
        );
      }

      if (target.owned) {
        // Already owned — nothing else to do.
        queryClient.invalidateQueries({ queryKey: ["library"] });
        queryClient.invalidateQueries({ queryKey: ["volumes", mangaData.mal_id] });
        return {
          added: !alreadyInLibrary,
          alreadyOwned: true,
          manga: mangaData,
          volumeNumber,
        };
      }

      // 3. Mark it owned (price 0, no store — user can edit later)
      await updateVolumeByID(target.id, true, 0, target.store ?? "");

      // 4. Update the library's volumes_owned counter from the server truth
      const refreshed = await getAllVolumesByID(mangaData.mal_id);
      await cacheVolumesForManga(mangaData.mal_id, refreshed);
      const ownedCount = refreshed.filter((v) => v.owned).length;
      await updateVolumeOwned(mangaData.mal_id, ownedCount);

      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({ queryKey: ["volumes", mangaData.mal_id] });

      return {
        added: !alreadyInLibrary,
        alreadyOwned: false,
        manga: mangaData,
        volumeNumber,
      };
    },
    [library]
  );
}
