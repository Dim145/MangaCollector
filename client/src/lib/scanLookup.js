import { isbn13Of } from "./isbn.js";

/**
 * 番 · Is this barcode already on the shelf?
 *
 * Matches the ISBN stored on a copy (set by the scanner when it was
 * added, or typed in the drawer), then the ISBN of an announced tome
 * (`release_isbn`) — both compared in the 13-digit form (`isbn13Of`).
 * Returns the volume, its series row and which field matched, or `null`.
 */
export function findLocalByIsbn(volumes, library, rawIsbn) {
  const isbn = isbn13Of(rawIsbn);
  if (!isbn) return null;
  const rows = Array.isArray(volumes) ? volumes : [];
  const byCopy = rows.find((v) => v?.isbn && isbn13Of(v.isbn) === isbn);
  const hit =
    byCopy ??
    rows.find((v) => v?.release_isbn && isbn13Of(v.release_isbn) === isbn);
  if (!hit) return null;
  const series =
    (Array.isArray(library) ? library : []).find(
      (s) => s.mal_id === hit.mal_id,
    ) ?? null;
  return { volume: hit, series, matchedOn: byCopy ? "isbn" : "release_isbn" };
}
