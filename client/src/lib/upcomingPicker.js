/**
 * 来 · Which series an upcoming volume can be noted for, from the calendar.
 *
 * The series page knows its own series and passes it to the upcoming
 * form directly. The calendar does not: the reader first picks one of
 * their series, and the form then proposes the next number. Both answers
 * come from the device cache (`db.library`, `db.volumes`), so the list is
 * there at once and works on a slow connection — only the save needs the
 * server.
 */

/** Lowercase, accents folded: "Ō", "é" and "e" all find each other. */
export function foldForSearch(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * The highest volume number known for each series, from the volume rows
 * — the same rule the series page uses for its own form, so both propose
 * the same next number.
 */
export function highestVolumeBySeries(volumes) {
  const highest = new Map();
  for (const v of volumes ?? []) {
    if (typeof v?.mal_id !== "number" || typeof v?.vol_num !== "number") continue;
    if (v.vol_num > (highest.get(v.mal_id) ?? 0)) highest.set(v.mal_id, v.vol_num);
  }
  return highest;
}

/**
 * The series to offer, filtered by `query` and sorted by name, each with
 * the number its next volume would carry. A series with no volume row
 * yet falls back to its announced count.
 */
export function seriesForUpcoming(library, volumes, query = "") {
  const highest = highestVolumeBySeries(volumes);
  const needle = foldForSearch(query);
  return (library ?? [])
    .filter((m) => typeof m?.mal_id === "number" && m.name)
    .filter((m) => !needle || foldForSearch(m.name).includes(needle))
    .map((m) => {
      const known = highest.get(m.mal_id) ?? Math.max(0, m.volumes ?? 0);
      return { manga: m, highest: known, next: known + 1 };
    })
    .sort((a, b) =>
      a.manga.name.localeCompare(b.manga.name, undefined, { sensitivity: "base" }),
    );
}

/** A local calendar day as `YYYY-MM-DD`, the shape `release_date` starts with. */
export function isoDay(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 未定 · Series still coming out whose next volume has no date on the
 * shelf — what the calendar lists under "No date yet", each with a way
 * to note the volume once its publisher announces it.
 *
 * "Still coming out" is what the shelf can tell: an edition the reader
 * marked `ongoing`, or one with no opinion whose MyAnimeList total is
 * unknown — MAL gives no volume count to a series still being published.
 * A completed, stopped or paused edition awaits nothing, and a series
 * with a volume dated today or later already has its date.
 */
export function seriesAwaitingDate(library, volumes, today = new Date()) {
  const todayIso = isoDay(today);
  const dated = new Set();
  for (const v of volumes ?? []) {
    if (v?.release_date && String(v.release_date).slice(0, 10) >= todayIso) {
      dated.add(v.mal_id);
    }
  }
  const highest = highestVolumeBySeries(volumes);
  return (library ?? [])
    .filter((m) => typeof m?.mal_id === "number" && m.name)
    .filter((m) =>
      m.publication_status === "ongoing"
        ? true
        : m.publication_status == null && !(m.volumes > 0),
    )
    .filter((m) => !dated.has(m.mal_id))
    .map((m) => {
      const known = highest.get(m.mal_id) ?? Math.max(0, m.volumes ?? 0);
      return { manga: m, highest: known, next: known + 1 };
    })
    .sort((a, b) =>
      a.manga.name.localeCompare(b.manga.name, undefined, { sensitivity: "base" }),
    );
}
