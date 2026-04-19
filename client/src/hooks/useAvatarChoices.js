import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useLibrary } from "@/hooks/useLibrary.js";
import { db } from "@/lib/db.js";

/**
 * Avatar picker data source — fetches character portraits for the user's
 * top-N series directly from Jikan and caches them locally.
 *
 * Strategy mirrors useMalRecommendations:
 *   1. Pick the top `sourceLimit` series by volumes_owned.
 *   2. For each, fetch `/v4/manga/{id}/characters` — 30-day Dexie cache.
 *   3. Aggregate into a `groups` array so the picker can render grouped tiles.
 *
 * Jikan limits to 3 req/s; we gap calls by `THROTTLE_MS` to stay well inside.
 */

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const THROTTLE_MS = 450;
const MAX_CHARACTERS_PER_SERIES = 16;

async function readCached(mal_id) {
  try {
    const row = await db.mangaCharacters.get(mal_id);
    if (!row) return null;
    if (Date.now() - row.ts > CACHE_TTL_MS) return null;
    return row;
  } catch {
    return null;
  }
}

async function writeCached(mal_id, seriesName, characters) {
  try {
    await db.mangaCharacters.put({
      mal_id,
      seriesName,
      characters,
      ts: Date.now(),
    });
  } catch {
    /* ignore quota errors */
  }
}

async function fetchCharacters(mal_id) {
  const res = await fetch(
    `https://api.jikan.moe/v4/manga/${mal_id}/characters`,
    { headers: { Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`Jikan ${res.status}`);
  const data = await res.json();

  // Response: { data: [{ character: { mal_id, name, images }, role }] }
  const roleWeight = { Main: 0, Supporting: 1 };
  return (data.data ?? [])
    .map((row) => ({
      mal_id: row.character?.mal_id,
      name: row.character?.name,
      role: row.role ?? "Supporting",
      imageUrl:
        row.character?.images?.jpg?.image_url ??
        row.character?.images?.webp?.image_url,
    }))
    .filter((c) => c.mal_id && c.imageUrl && !c.imageUrl.endsWith("questionmark_23.gif"))
    .sort(
      (a, b) =>
        (roleWeight[a.role] ?? 2) - (roleWeight[b.role] ?? 2) ||
        a.name.localeCompare(b.name)
    )
    .slice(0, MAX_CHARACTERS_PER_SERIES);
}

export function useAvatarChoices({ sourceLimit = 10 } = {}) {
  const { data: library } = useLibrary();
  const [error, setError] = useState(null);
  const [fetching, setFetching] = useState(false);

  const cachedRows = useLiveQuery(() => db.mangaCharacters.toArray(), []);

  // Pick source series — owned-volume-weighted so the user's favourites
  // surface first. Filter out custom entries (negative mal_id).
  const sources = useMemo(() => {
    if (!library?.length) return [];
    return [...library]
      .filter((m) => typeof m.mal_id === "number" && m.mal_id > 0)
      .sort((a, b) => (b.volumes_owned ?? 0) - (a.volumes_owned ?? 0))
      .slice(0, sourceLimit)
      .map((m) => ({ mal_id: m.mal_id, name: m.name }));
  }, [library, sourceLimit]);

  useEffect(() => {
    if (!sources.length) return;
    let cancelled = false;

    (async () => {
      setFetching(true);
      try {
        for (const src of sources) {
          if (cancelled) return;
          const cached = await readCached(src.mal_id);
          if (cached !== null) continue;
          try {
            const characters = await fetchCharacters(src.mal_id);
            await writeCached(src.mal_id, src.name, characters);
            await new Promise((r) => setTimeout(r, THROTTLE_MS));
          } catch (err) {
            if (String(err?.message).includes("429")) {
              setError("jikan-rate-limit");
              break;
            }
            // 404 / transient — cache empty so we don't retry on every open
            await writeCached(src.mal_id, src.name, []);
          }
        }
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sources]);

  // Build grouped output: one entry per source series with fresh characters.
  // Preserve the source order (already sorted by volumes_owned desc).
  const groups = useMemo(() => {
    if (!cachedRows?.length || !sources.length) return [];
    const byId = new Map(cachedRows.map((r) => [r.mal_id, r]));
    return sources
      .map((src) => {
        const row = byId.get(src.mal_id);
        return row
          ? {
              mal_id: src.mal_id,
              seriesName: src.name,
              characters: row.characters ?? [],
            }
          : null;
      })
      .filter((g) => g && g.characters.length > 0);
  }, [cachedRows, sources]);

  return {
    groups,
    isLoading: fetching && groups.length === 0,
    isFetching: fetching,
    hasSources: sources.length > 0,
    error,
  };
}
