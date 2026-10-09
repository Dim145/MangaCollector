import http from "@/utils/axios.js";

/**
 * 源 · MyAnimeList data the browser shows but does not keep — a manga's
 * readers' recommendations, its characters, one manga's details.
 *
 * It used to be fetched from Jikan by the browser itself, at an address
 * written into the bundle. It comes from our own server now
 * (`/api/external/mal/…`), which asks whichever upstream the operator
 * configured — the official MyAnimeList API when it has a client id, a
 * Jikan mirror at `JIKAN_API_URL`, or the public Jikan — and keeps the
 * reader's address to itself.
 */

/** The error state a screen shows when no upstream answered. */
export const MAL_UNAVAILABLE = "mal-unavailable";

/** GET `/api/external/mal/{path}` — `path` is `"{id}"`, `"{id}/recommendations"` or `"{id}/characters"`. */
export async function getMal(path) {
  const { data } = await http.get(`/api/external/mal/${path}`);
  return data;
}

/**
 * Whether a failed request is an *answer* — a 404: there is nothing to
 * show for this manga, and that may be remembered. Everything else (the
 * upstream down, a 429, the device offline) is not, and caching an
 * empty result for it would hide the real data for the cache's whole
 * lifetime: the caller stops and tries again next time.
 */
export function isMissing(err) {
  return err?.response?.status === 404;
}
