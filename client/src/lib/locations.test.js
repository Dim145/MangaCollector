import { describe, expect, it } from "vitest";
import {
  UNFILED,
  groupByLocation,
  listPlaces,
  mergeLocationNames,
  movePayloads,
} from "./locations.js";

const library = [
  { mal_id: 13, name: "One Piece", image_url_jpg: "op.jpg" },
  { mal_id: 2, name: "Berserk" },
];
const volumes = [
  {
    id: 1,
    mal_id: 13,
    vol_num: 2,
    owned: true,
    location: "Étagère A",
    price: "7.5",
    store: "Fnac",
    collector: false,
  },
  {
    id: 2,
    mal_id: 13,
    vol_num: 1,
    owned: true,
    location: " Étagère A ",
    price: null,
  },
  { id: 3, mal_id: 2, vol_num: 1, owned: true, location: "Carton 3" },
  { id: 4, mal_id: 2, vol_num: 2, owned: true, location: "" },
  { id: 5, mal_id: 2, vol_num: 3, owned: false, location: "Carton 3" },
];

describe("groupByLocation", () => {
  it("groups owned tomes by trimmed place, then by series, sorted", () => {
    const { places, unfiled } = groupByLocation(volumes, library);
    expect([...places.keys()]).toEqual(["Étagère A", "Carton 3"]);
    const a = places.get("Étagère A");
    expect(a.count).toBe(2);
    expect(a.series[0].name).toBe("One Piece");
    expect(a.series[0].tomes.map((v) => v.vol_num)).toEqual([1, 2]);
    expect(places.get("Carton 3").count).toBe(1);
    expect(unfiled.count).toBe(1);
    expect(unfiled.name).toBe(UNFILED);
  });
});

describe("listPlaces", () => {
  it("keeps the registry order and appends names known only from tomes", () => {
    const registry = [
      { id: 9, name: "Carton 3", note: "grenier", position: 1 },
      { id: 8, name: "Étagère A", note: null, position: 0 },
      { id: 7, name: "Vide", note: null, position: 2 },
    ];
    const groups = groupByLocation(
      [
        ...volumes,
        { id: 6, mal_id: 2, vol_num: 4, owned: true, location: "Bureau" },
      ],
      library,
    );
    const places = listPlaces(registry, groups);
    expect(places.map((p) => [p.name, p.count])).toEqual([
      ["Étagère A", 2],
      ["Carton 3", 1],
      ["Vide", 0],
      ["Bureau", 1],
    ]);
    expect(places[1].note).toBe("grenier");
    expect(places[3].id).toBeNull();
  });
});

describe("mergeLocationNames", () => {
  it("lists registry names first, then extras alphabetically, no duplicates", () => {
    const registry = [
      { name: "Carton 3", position: 1 },
      { name: "Étagère A", position: 0 },
    ];
    expect(
      mergeLocationNames(registry, [...volumes, { location: "Bureau" }]),
    ).toEqual(["Étagère A", "Carton 3", "Bureau"]);
  });
});

describe("movePayloads", () => {
  it("builds outbox payloads only for tomes that actually move", () => {
    const out = movePayloads(volumes, [1, 2, 3], "Étagère A");
    expect(out).toEqual([
      {
        id: 3,
        mal_id: 2,
        vol_num: 1,
        owned: true,
        price: 0,
        store: "",
        collector: false,
        location: "Étagère A",
      },
    ]);
    expect(movePayloads(volumes, new Set([1]), null)[0]).toMatchObject({
      id: 1,
      price: 7.5,
      store: "Fnac",
      location: null,
    });
  });
});
