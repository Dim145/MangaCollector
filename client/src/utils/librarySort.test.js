import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT,
  SORT_KEYS,
  defaultDirFor,
  normalizeSort,
  sortLibrary,
} from "./librarySort.js";

/*
 * The dashboard grid used to come out in Dexie primary-key order —
 * custom series first, then MAL ids ascending — which is no order at
 * all from the reader's chair. These pin the contract of the explicit
 * sort that replaced it: a title default, per-key natural directions,
 * gaps always last, ties broken by title, input never mutated.
 */

const s = (over) => ({
  mal_id: 1,
  name: "Series",
  volumes: 10,
  volumes_owned: 5,
  created_on: "2026-01-01T00:00:00Z",
  modified_on: "2026-01-01T00:00:00Z",
  author: null,
  ...over,
});

const names = (list) => list.map((m) => m.name);

describe("normalizeSort", () => {
  it("defaults to title A→Z for nothing, junk and unknown keys", () => {
    expect(normalizeSort(undefined)).toEqual(DEFAULT_SORT);
    expect(normalizeSort("title")).toEqual(DEFAULT_SORT);
    expect(normalizeSort({ key: "colour" })).toEqual(DEFAULT_SORT);
  });

  it("fills a missing or invalid direction with the key's natural one", () => {
    expect(normalizeSort({ key: "added" })).toEqual({ key: "added", dir: "desc" });
    expect(normalizeSort({ key: "added", dir: "up" })).toEqual({
      key: "added",
      dir: "desc",
    });
    expect(normalizeSort({ key: "added", dir: "asc" })).toEqual({
      key: "added",
      dir: "asc",
    });
  });

  it("gives every key a natural direction", () => {
    for (const k of SORT_KEYS) {
      expect(["asc", "desc"]).toContain(defaultDirFor(k.id));
    }
    expect(defaultDirFor("nope")).toBe("asc");
  });
});

describe("sortLibrary — title", () => {
  it("orders A→Z, folding case, accents and brackets, numbers naturally", () => {
    const list = [
      s({ mal_id: 1, name: "vol 10" }),
      s({ mal_id: 2, name: "Élan" }),
      s({ mal_id: 3, name: "berserk" }),
      s({ mal_id: 4, name: "Vol 2" }),
      s({ mal_id: 5, name: "Akira" }),
      s({ mal_id: 6, name: "【Oshi no Ko】" }),
    ];
    expect(names(sortLibrary(list, { key: "title", dir: "asc" }))).toEqual([
      "Akira",
      "berserk",
      "Élan",
      "【Oshi no Ko】",
      "Vol 2",
      "vol 10",
    ]);
  });

  it("flips with dir but keeps nameless series last either way", () => {
    const list = [s({ mal_id: 1, name: "" }), s({ mal_id: 2, name: "B" }), s({ mal_id: 3, name: "A" })];
    expect(names(sortLibrary(list, { key: "title", dir: "desc" }))).toEqual(["B", "A", ""]);
    expect(names(sortLibrary(list, { key: "title", dir: "asc" }))).toEqual(["A", "B", ""]);
  });

  it("does not mutate the input", () => {
    const list = [s({ mal_id: 1, name: "B" }), s({ mal_id: 2, name: "A" })];
    const copy = [...list];
    sortLibrary(list, DEFAULT_SORT);
    expect(list).toEqual(copy);
  });
});

describe("sortLibrary — dates", () => {
  const list = [
    s({ mal_id: 1, name: "old", created_on: "2024-05-01T00:00:00Z" }),
    s({ mal_id: 2, name: "new", created_on: "2026-09-01T00:00:00Z" }),
    s({ mal_id: 3, name: "undated", created_on: null }),
    s({ mal_id: 4, name: "mid", created_on: "2025-01-01T00:00:00Z" }),
  ];

  it("puts the newest addition first by default and undated last", () => {
    expect(names(sortLibrary(list, { key: "added" }))).toEqual([
      "new",
      "mid",
      "old",
      "undated",
    ]);
  });

  it("keeps undated last when flipped to oldest first", () => {
    expect(names(sortLibrary(list, { key: "added", dir: "asc" }))).toEqual([
      "old",
      "mid",
      "new",
      "undated",
    ]);
  });

  it("reads modified_on for the updated key", () => {
    const l = [
      s({ mal_id: 1, name: "stale", modified_on: "2025-01-01T00:00:00Z" }),
      s({ mal_id: 2, name: "fresh", modified_on: "2026-09-12T00:00:00Z" }),
    ];
    expect(names(sortLibrary(l, { key: "updated" }))).toEqual(["fresh", "stale"]);
  });
});

describe("sortLibrary — counts", () => {
  it("ranks completion by ratio, series without a total last", () => {
    const list = [
      s({ mal_id: 1, name: "half", volumes: 10, volumes_owned: 5 }),
      s({ mal_id: 2, name: "done", volumes: 4, volumes_owned: 4 }),
      s({ mal_id: 3, name: "unknown", volumes: 0, volumes_owned: 3 }),
      s({ mal_id: 4, name: "started", volumes: 20, volumes_owned: 1 }),
    ];
    expect(names(sortLibrary(list, { key: "progress" }))).toEqual([
      "done",
      "half",
      "started",
      "unknown",
    ]);
  });

  it("ranks the biggest gaps first for missing, never below zero", () => {
    const list = [
      s({ mal_id: 1, name: "gap3", volumes: 10, volumes_owned: 7 }),
      s({ mal_id: 2, name: "over", volumes: 4, volumes_owned: 6 }),
      s({ mal_id: 3, name: "gap12", volumes: 12, volumes_owned: 0 }),
      s({ mal_id: 4, name: "unknown", volumes: 0, volumes_owned: 1 }),
    ];
    expect(names(sortLibrary(list, { key: "missing" }))).toEqual([
      "gap12",
      "gap3",
      "over",
      "unknown",
    ]);
  });

  it("ranks owned volumes, ties broken by title", () => {
    const list = [
      s({ mal_id: 1, name: "Zed", volumes_owned: 3 }),
      s({ mal_id: 2, name: "Alpha", volumes_owned: 3 }),
      s({ mal_id: 3, name: "Many", volumes_owned: 30 }),
    ];
    expect(names(sortLibrary(list, { key: "owned" }))).toEqual([
      "Many",
      "Alpha",
      "Zed",
    ]);
  });
});

describe("sortLibrary — author and upcoming", () => {
  it("orders by author name with authorless series last", () => {
    const list = [
      s({ mal_id: 1, name: "b", author: { id: 1, name: "Urasawa" } }),
      s({ mal_id: 2, name: "c", author: null }),
      s({ mal_id: 3, name: "a", author: { id: 2, name: "Inoue" } }),
    ];
    expect(names(sortLibrary(list, { key: "author" }))).toEqual(["a", "b", "c"]);
  });

  it("uses the dashboard's next-release map, soonest first, nothing announced last", () => {
    const list = [
      s({ mal_id: 1, name: "later" }),
      s({ mal_id: 2, name: "quiet" }),
      s({ mal_id: 3, name: "soon" }),
    ];
    const nextUpcomingByMal = new Map([
      [1, { vol_num: 12, release_date_ms: Date.UTC(2026, 11, 1) }],
      [3, { vol_num: 5, release_date_ms: Date.UTC(2026, 9, 1) }],
    ]);
    expect(
      names(sortLibrary(list, { key: "upcoming" }, { nextUpcomingByMal })),
    ).toEqual(["soon", "later", "quiet"]);
  });

  it("treats a missing context as nothing announced", () => {
    const list = [s({ mal_id: 1, name: "b" }), s({ mal_id: 2, name: "a" })];
    expect(names(sortLibrary(list, { key: "upcoming" }))).toEqual(["a", "b"]);
  });
});
