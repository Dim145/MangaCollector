import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useLibrary } from "@/hooks/useLibrary.js";
import { db } from "@/lib/db.js";

/**
 * R2 — Related-manga recommendations powered by Jikan.
 *
 * Strategy:
 *   1. Pick the user's "signal" series — those with the most volumes owned,
 *      capped at `sourceLimit`. These are the strongest signals for taste.
 *   2. For each, fetch `/manga/{id}/recommendations` from Jikan — cached in
 *      Dexie for 30 days so we don't hammer the API on every render.
 *   3. Aggregate across sources: score = Σ votes across all source series.
 *   4. Filter out manga the user already owns.
 *   5. Return top `limit` by score.
 *
 * Jikan rate limit: 3 req/s (hard) / 60 req/min. We serialize calls with a
 * 450 ms gap, well within the per-second budget.
 */

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const THROTTLE_MS = 450;

async function readCached(mal_id) {
  try {
    const row = await db.malRecommendations.get(mal_id);
    if (!row) return null;
    if (Date.now() - row.ts > CACHE_TTL_MS) return null;
    return row.recommendations ?? [];
  } catch {
    return null;
  }
}

async function writeCached(mal_id, recommendations) {
  try {
    await db.malRecommendations.put({
      mal_id,
      recommendations,
      ts: Date.now(),
    });
  } catch {
    /* ignore quota errors */
  }
}

async function fetchRecs(mal_id) {
  const res = await fetch(
    `https://api.jikan.moe/v4/manga/${mal_id}/recommendations`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`Jikan ${res.status}`);
  const data = await res.json();
  // Each item has { entry: { mal_id, title, images, … }, votes, url }
  return (data.data ?? []).map((it) => ({
    mal_id: it.entry?.mal_id,
    title: it.entry?.title,
    image_url:
      it.entry?.images?.jpg?.image_url ??
      it.entry?.images?.jpg?.small_image_url,
    votes: it.votes ?? 1,
  }));
}

export function useMalRecommendations({ sourceLimit = 10, limit = 8 } = {}) {
  const { data: library } = useLibrary();
  const [error, setError] = useState(null);
  const [fetching, setFetching] = useState(false);

  // Build the cached recommendations map reactively so that once an entry
  // is cached, the UI updates without a re-fetch.
  const cachedRows = useLiveQuery(() => db.malRecommendations.toArray(), []);

  // Pick source series — stable order so we don't re-fetch on every render
  const sources = useMemo(() => {
    if (!library?.length) return [];
    return [...library]
      .filter((m) => typeof m.mal_id === "number" && m.mal_id > 0)
      .sort((a, b) => (b.volumes_owned ?? 0) - (a.volumes_owned ?? 0))
      .slice(0, sourceLimit)
      .map((m) => m.mal_id);
  }, [library, sourceLimit]);

  // Fire off fetches for any source with stale or missing cache
  useEffect(() => {
    if (!sources.length) return;
    let cancelled = false;

    (async () => {
      setFetching(true);
      try {
        for (const mal_id of sources) {
          if (cancelled) return;
          const cached = await readCached(mal_id);
          if (cached !== null) continue; // fresh
          try {
            const recs = await fetchRecs(mal_id);
            await writeCached(mal_id, recs);
            await new Promise((r) => setTimeout(r, THROTTLE_MS));
          } catch (err) {
            // Stop on 429 — Jikan is throttling us, try next session
            if (String(err?.message).includes("429")) {
              setError("jikan-rate-limit");
              break;
            }
            // 404 / transient — just skip this source
            await writeCached(mal_id, []);
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

  // Aggregate live from Dexie cache + filter against the library
  const recommendations = useMemo(() => {
    if (!cachedRows?.length || !library) return [];
    const ownedIds = new Set(library.map((m) => m.mal_id));

    // { mal_id → { title, image_url, score, sources: [] } }
    const bag = new Map();
    for (const row of cachedRows) {
      if (!sources.includes(row.mal_id)) continue;
      for (const rec of row.recommendations ?? []) {
        if (!rec.mal_id || ownedIds.has(rec.mal_id)) continue;
        const existing = bag.get(rec.mal_id);
        if (existing) {
          existing.score += rec.votes ?? 1;
          existing.sourceCount += 1;
        } else {
          bag.set(rec.mal_id, {
            mal_id: rec.mal_id,
            title: rec.title,
            image_url: rec.image_url,
            score: rec.votes ?? 1,
            sourceCount: 1,
          });
        }
      }
    }

    return Array.from(bag.values())
      .sort((a, b) => b.score - a.score || b.sourceCount - a.sourceCount)
      .slice(0, limit);
  }, [cachedRows, library, sources, limit]);

  return {
    data: recommendations,
    isLoading: fetching && recommendations.length === 0,
    isFetching: fetching,
    hasSources: sources.length > 0,
    error,
  };
}
