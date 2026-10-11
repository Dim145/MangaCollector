import { beforeEach, describe, expect, it } from "vitest";
import {
  classifyScan,
  clearQueue,
  loadQueue,
  matchSeriesByTitle,
  queueSummary,
  resolveWithBook,
  saveQueue,
} from "./scanQueue.js";

/*
 * A batch of barcodes is sorted the moment each is read, from the shelf
 * alone; an unknown one can still find its tome once a catalogue names
 * the series and the number. What is kept for the session is the list
 * of barcodes, never a standing that the shelf may since have changed.
 */

const OP = "9782723488525"; // One Piece 1 (valid EAN-13)
const OP2 = "9782723489621";
const NARUTO = "9782871294146";

const library = [
  { mal_id: 13, name: "One Piece" },
  { mal_id: 11, name: "Naruto" },
  { mal_id: 21, name: "One Punch Man" },
  { mal_id: 30, name: "Akira" },
  { mal_id: 31, name: "Akira (Édition originale)" },
];
const ANNOUNCED = "9782505011514";
const volumes = [
  { id: 1, mal_id: 13, vol_num: 1, owned: true, isbn: OP },
  { id: 2, mal_id: 13, vol_num: 2, owned: false, release_isbn: OP2, release_date: "2020-01-01T00:00:00Z" },
  { id: 5, mal_id: 13, vol_num: 111, owned: false, release_isbn: ANNOUNCED, release_date: "2099-11-11T00:00:00Z" },
  { id: 3, mal_id: 11, vol_num: 1, owned: false },
  { id: 4, mal_id: 11, vol_num: 2, owned: true },
];

describe("classifyScan", () => {
  it("knows an owned copy, a tome not owned yet, and a stranger", () => {
    expect(classifyScan(OP, volumes, library)).toMatchObject({ kind: "owned", series: { mal_id: 13 } });
    expect(classifyScan(OP2, volumes, library)).toMatchObject({ kind: "missing", matched: "release_isbn" });
    expect(classifyScan(NARUTO, volumes, library)).toMatchObject({ kind: "unknown", volume: null });
  });

  it("sets apart an announced tome whose date is still ahead — it cannot be owned yet", () => {
    expect(classifyScan(ANNOUNCED, volumes, library)).toMatchObject({ kind: "upcoming", volume: { id: 5 } });
  });

  it("refuses what is not an ISBN", () => {
    expect(classifyScan("123", volumes, library)).toBeNull();
  });
});

describe("matchSeriesByTitle", () => {
  it("matches folded titles, exactly first", () => {
    expect(matchSeriesByTitle(library, "ONE PIECE")?.mal_id).toBe(13);
    expect(matchSeriesByTitle(library, "naruto")?.mal_id).toBe(11);
  });

  it("matches a title that begins the other, when only one does", () => {
    expect(matchSeriesByTitle(library, "One Punch")?.mal_id).toBe(21);
  });

  it("gives up when several series could be meant or the title is too short", () => {
    expect(matchSeriesByTitle(library, "One")).toBeNull();
    expect(matchSeriesByTitle([{ mal_id: 1, name: "Blame!" }, { mal_id: 2, name: "Blame! Academy" }], "Blam")).toBeNull();
    expect(matchSeriesByTitle(library, "")).toBeNull();
  });
});

describe("resolveWithBook", () => {
  const unknown = { isbn: NARUTO, kind: "unknown", volume: null, series: null, book: null, matched: null };

  it("takes the standing of the tome the catalogue names", () => {
    const item = resolveWithBook(unknown, { title: "Naruto", volume: 1 }, volumes, library);
    expect(item).toMatchObject({ kind: "missing", matched: "catalogue", volume: { id: 3 } });
    const owned = resolveWithBook(unknown, { title: "Naruto", volume: 2 }, volumes, library);
    expect(owned.kind).toBe("owned");
  });

  it("stays unknown, book kept, when the series or the tome is not on the shelf", () => {
    const noSeries = resolveWithBook(unknown, { title: "Berserk", volume: 1 }, volumes, library);
    expect(noSeries).toMatchObject({ kind: "unknown", book: { title: "Berserk" } });
    const noTome = resolveWithBook(unknown, { title: "Naruto", volume: 72 }, volumes, library);
    expect(noTome.kind).toBe("unknown");
    const noNumber = resolveWithBook(unknown, { title: "Naruto" }, volumes, library);
    expect(noNumber.kind).toBe("unknown");
  });

  it("leaves an item that was already placed alone", () => {
    const placed = classifyScan(OP, volumes, library);
    expect(resolveWithBook(placed, { title: "Naruto", volume: 1 }, volumes, library)).toBe(placed);
  });
});

describe("queueSummary", () => {
  it("counts by standing", () => {
    const items = [OP, OP2, NARUTO].map((i) => classifyScan(i, volumes, library));
    expect(queueSummary(items)).toEqual({ total: 3, owned: 1, missing: 1, upcoming: 0, unknown: 1 });
    expect(queueSummary([])).toEqual({ total: 0, owned: 0, missing: 0, upcoming: 0, unknown: 0 });
  });
});

describe("saveQueue / loadQueue", () => {
  beforeEach(() => clearQueue());

  it("keeps the barcodes and re-reads them against today's shelf", () => {
    const items = [classifyScan(OP2, volumes, library), classifyScan(NARUTO, volumes, library)];
    items[1] = { ...items[1], book: { title: "Naruto", volume: 1 } };
    saveQueue(items);
    // Meanwhile One Piece 2 was bought.
    const later = volumes.map((v) => (v.id === 2 ? { ...v, owned: true } : v));
    const back = loadQueue(later, library);
    expect(back.map((i) => i.kind)).toEqual(["owned", "missing"]);
    expect(back[1].matched).toBe("catalogue");
  });

  it("answers an empty batch when nothing or garbage is kept", () => {
    expect(loadQueue(volumes, library)).toEqual([]);
    sessionStorage.setItem("mc:scan-queue", "{not json");
    expect(loadQueue(volumes, library)).toEqual([]);
  });
});
