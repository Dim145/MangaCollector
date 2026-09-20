import { useEffect, useState } from "react";
import {
  preloadVolumeOverlays,
  volumeOverlays,
  volumeOverlaysReady,
} from "@/components/volumeOverlays.js";

/**
 * 扉 · The volume drawer and the loan sheet, once they have arrived.
 *
 * Returns `null` until then, so a card renders nothing where the
 * overlay will go. In practice it is never null when it matters:
 * `MangaPage` fetches both while the page is idle, long before a
 * reader can tap. `needed` is what a card is about to open — asking
 * for them is what starts the import for a reader who tapped first.
 */
export function useVolumeOverlays(needed) {
  const [ready, setReady] = useState(volumeOverlaysReady);

  useEffect(() => {
    if (!needed || ready) return undefined;
    let alive = true;
    preloadVolumeOverlays().then(
      () => {
        if (alive) setReady(true);
      },
      // Handled, not swallowed: the card stays as it was and the next
      // tap retries. Without this arm it is an unhandled rejection.
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [needed, ready]);

  return ready ? volumeOverlays() : null;
}
