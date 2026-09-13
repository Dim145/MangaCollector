import { describe, expect, it } from "vitest";
import { isbn13Of } from "./isbn.js";
import { findLocalByIsbn } from "./scanLookup.js";

/*
 * The global scanner asks the shelf before any catalogue: a barcode that
 * matches a copy's ISBN — or the ISBN of an announced tome — opens that
 * tome instead of starting an add flow.
 */

const library = [
  { mal_id: 13, name: "One Piece" },
  { mal_id: 2, name: "Berserk" },
];
const volumes = [
  { id: 1, mal_id: 13, vol_num: 1, isbn: "9780306406157" },
  { id: 2, mal_id: 13, vol_num: 111, release_isbn: "0-8044-2957-X" },
  { id: 3, mal_id: 2, vol_num: 3 },
];

describe("findLocalByIsbn", () => {
  it("finds a copy by its stored ISBN, separators ignored", () => {
    const r = findLocalByIsbn(volumes, library, "978-0-306-40615-7");
    expect(r.volume.id).toBe(1);
    expect(r.series.name).toBe("One Piece");
    expect(r.matchedOn).toBe("isbn");
  });

  it("falls back to an announced tome's ISBN, converting ISBN-10", () => {
    const r = findLocalByIsbn(volumes, library, "9780804429573");
    expect(r.volume.vol_num).toBe(111);
    expect(r.matchedOn).toBe("release_isbn");
  });

  it("returns null for an unknown or invalid barcode", () => {
    expect(findLocalByIsbn(volumes, library, "9784088725093")).toBeNull();
    expect(findLocalByIsbn(volumes, library, "nope")).toBeNull();
    expect(findLocalByIsbn(undefined, undefined, "9780306406157")).toBeNull();
  });

  it("still returns the volume when the series row is missing", () => {
    const r = findLocalByIsbn(volumes, [], "9780306406157");
    expect(r.volume.id).toBe(1);
    expect(r.series).toBeNull();
  });
});

describe("isbn13Of", () => {
  it("keeps a valid ISBN-13 and converts a valid ISBN-10", () => {
    expect(isbn13Of("978-0-306-40615-7")).toBe("9780306406157");
    expect(isbn13Of("0306406152")).toBe("9780306406157");
    expect(isbn13Of("0-8044-2957-X")).toBe("9780804429573");
  });

  it("returns null for anything that is not an ISBN", () => {
    expect(isbn13Of("9780306406158")).toBeNull();
    expect(isbn13Of("")).toBeNull();
    expect(isbn13Of(undefined)).toBeNull();
  });
});
