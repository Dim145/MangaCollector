/**
 * 棚 · Pure helpers for places (shelves, boxes, rooms).
 *
 * A tome points at its place by name (`volume.location`); the registry
 * (`db.locations`, mirrored from `/api/user/locations`) adds a note and
 * an order. Everything here works from the cached rows, so the
 * Rangement page reads fully offline.
 */

/** Sentinel for "no place at all" in the UI — never a real name. */
export const UNFILED = "__unfiled__";

export function normalizeLocationName(raw) {
  return String(raw ?? "").trim();
}

function seriesIndex(library) {
  const map = new Map();
  for (const s of Array.isArray(library) ? library : []) {
    if (s?.mal_id != null) map.set(s.mal_id, s);
  }
  return map;
}

/**
 * Owned tomes grouped by place, then by series. Returns
 * `{ places: Map<name, group>, unfiled: group }` where a group is
 * `{ name, count, series: [{ mal_id, name, image_url_jpg, tomes }] }`,
 * series sorted by name and tomes by number.
 */
export function groupByLocation(volumes, library) {
  const idx = seriesIndex(library);
  const places = new Map();
  const unfiled = { name: UNFILED, count: 0, series: new Map() };
  const bucketFor = (name) => {
    if (!name) return unfiled;
    if (!places.has(name))
      places.set(name, { name, count: 0, series: new Map() });
    return places.get(name);
  };
  for (const v of Array.isArray(volumes) ? volumes : []) {
    if (!v?.owned) continue;
    const bucket = bucketFor(normalizeLocationName(v.location));
    bucket.count += 1;
    const entry = idx.get(v.mal_id);
    if (!bucket.series.has(v.mal_id)) {
      bucket.series.set(v.mal_id, {
        mal_id: v.mal_id,
        name: entry?.name ?? "",
        image_url_jpg: entry?.image_url_jpg ?? null,
        tomes: [],
      });
    }
    bucket.series.get(v.mal_id).tomes.push(v);
  }
  const finish = (group) => ({
    ...group,
    series: [...group.series.values()]
      .map((s) => ({
        ...s,
        tomes: [...s.tomes].sort((a, b) => a.vol_num - b.vol_num),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
  const out = new Map();
  for (const [name, group] of places) out.set(name, finish(group));
  return { places: out, unfiled: finish(unfiled) };
}

/**
 * The registry rows, in their order, followed by any name that only
 * exists on tomes (typed offline, not yet registered) — each with its
 * live count.
 */
export function listPlaces(registry, groups) {
  const rows = [...(Array.isArray(registry) ? registry : [])].sort(
    (a, b) =>
      (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name),
  );
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const name = normalizeLocationName(r.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      id: r.id ?? null,
      name,
      note: r.note ?? null,
      position: r.position ?? 0,
      count: groups?.places?.get(name)?.count ?? 0,
    });
  }
  const extras = [...(groups?.places?.keys() ?? [])]
    .filter((name) => !seen.has(name))
    .sort((a, b) => a.localeCompare(b));
  for (const name of extras) {
    out.push({
      id: null,
      name,
      note: null,
      position: out.length,
      count: groups.places.get(name).count,
    });
  }
  return out;
}

/** Datalist options: registry names first, then the rest, no duplicates. */
export function mergeLocationNames(registry, volumes) {
  const names = [];
  const seen = new Set();
  const push = (raw) => {
    const name = normalizeLocationName(raw);
    if (!name || seen.has(name)) return;
    seen.add(name);
    names.push(name);
  };
  for (const r of [...(Array.isArray(registry) ? registry : [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  ))
    push(r.name);
  const extras = new Set();
  for (const v of Array.isArray(volumes) ? volumes : []) {
    const name = normalizeLocationName(v?.location);
    if (name && !seen.has(name)) extras.add(name);
  }
  for (const name of [...extras].sort((a, b) => a.localeCompare(b))) push(name);
  return names;
}

/**
 * Outbox payloads that file the given tomes under `location` (`null`
 * unfiles). Only what `enqueueVolumeUpdate` needs, taken from the rows.
 */
export function movePayloads(volumes, ids, location) {
  const wanted = ids instanceof Set ? ids : new Set(ids);
  const target = normalizeLocationName(location) || null;
  const out = [];
  for (const v of Array.isArray(volumes) ? volumes : []) {
    if (!wanted.has(v.id)) continue;
    if ((normalizeLocationName(v.location) || null) === target) continue;
    out.push({
      id: v.id,
      mal_id: v.mal_id,
      vol_num: v.vol_num,
      owned: Boolean(v.owned),
      price: Number(v.price) || 0,
      store: v.store ?? "",
      collector: Boolean(v.collector),
      location: target,
    });
  }
  return out;
}
