import { describe, expect, it } from "vitest";
import {
  applyScan,
  buildSession,
  loadSession,
  missingCsv,
  saveSession,
  summarize,
  toggleSeen,
} from "./inventory.js";

const library = [
  { mal_id: 13, name: "One Piece" },
  { mal_id: 2, name: "Berserk" },
];
const volumes = [
  {
    id: 1,
    mal_id: 13,
    vol_num: 1,
    owned: true,
    isbn: "9780306406157",
    location: "Étagère A",
  },
  {
    id: 2,
    mal_id: 13,
    vol_num: 2,
    owned: true,
    isbn: null,
    location: "Étagère A",
    loaned_to: "Alex",
  },
  {
    id: 3,
    mal_id: 2,
    vol_num: 1,
    owned: true,
    isbn: "9780804429573",
    location: "Carton 3",
  },
  { id: 4, mal_id: 2, vol_num: 2, owned: false, isbn: null },
];
const NOW = new Date("2026-09-14T10:00:00Z");

describe("buildSession", () => {
  it("expects the owned tomes of the scope only", () => {
    expect(buildSession({ kind: "all" }, volumes, NOW).expected).toEqual([
      3, 1, 2,
    ]);
    expect(
      buildSession({ kind: "series", mal_id: 13 }, volumes, NOW).expected,
    ).toEqual([1, 2]);
    expect(
      buildSession({ kind: "place", name: " Carton 3 " }, volumes, NOW)
        .expected,
    ).toEqual([3]);
  });
});

describe("applyScan", () => {
  const start = buildSession({ kind: "series", mal_id: 13 }, volumes, NOW);

  it("ticks a tome once, then reports repeats", () => {
    const first = applyScan(start, "978-0-306-40615-7", volumes, library, NOW);
    expect(first.outcome).toBe("present");
    expect(first.volume.id).toBe(1);
    expect(first.session.seen[1]).toBe(NOW.toISOString());
    const again = applyScan(
      first.session,
      "9780306406157",
      volumes,
      library,
      NOW,
    );
    expect(again.outcome).toBe("repeat");
    expect(again.session).toBe(first.session);
  });

  it("tells a tome outside the scope from an unknown barcode and junk", () => {
    const outside = applyScan(start, "9780804429573", volumes, library, NOW);
    expect(outside.outcome).toBe("outside");
    expect(outside.session.outside).toEqual([{ id: 3, isbn: "9780804429573" }]);
    const unknown = applyScan(start, "9782505118947", volumes, library, NOW);
    expect(unknown.outcome).toBe("unknown");
    expect(unknown.session.unknown).toEqual(["9782505118947"]);
    expect(applyScan(start, "12345", volumes, library, NOW).outcome).toBe(
      "invalid",
    );
  });
});

describe("summarize + toggleSeen + csv", () => {
  it("splits present, missing and lent, and lists the missing as CSV", () => {
    let session = buildSession({ kind: "all" }, volumes, NOW);
    session = toggleSeen(session, 3, NOW);
    const s = summarize(session, volumes, library);
    expect(s.total).toBe(3);
    expect(s.present.map((v) => v.id)).toEqual([3]);
    expect(s.missing.map((v) => v.id)).toEqual([1]);
    expect(s.lent.map((v) => v.id)).toEqual([2]);
    const csv = missingCsv(s);
    expect(csv.split("\n")[1]).toBe("One Piece,1,Étagère A,");
    expect(csv.split("\n")[2]).toBe("One Piece,2,Étagère A,Alex");
    expect(toggleSeen(session, 3, NOW).seen[3]).toBeUndefined();
  });

  it("round-trips through storage and ignores junk", () => {
    const store = new Map();
    const storage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    };
    const session = buildSession({ kind: "all" }, volumes, NOW);
    saveSession(session, storage);
    expect(loadSession(storage)).toEqual(session);
    storage.setItem("mc.inventory.v1", "{not json");
    expect(loadSession(storage)).toBeNull();
    saveSession(null, storage);
    expect(loadSession(storage)).toBeNull();
  });
});
