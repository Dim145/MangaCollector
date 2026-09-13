// Real in-memory IndexedDB so the Dexie transactions in the cache
// writers run for real. Must load before anything imports db.js.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queryClient.js", () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    removeQueries: vi.fn(),
  },
}));

const {
  cacheAllVolumes,
  cacheAuthor,
  cacheCoffretsForManga,
  cacheLibrary,
  cacheLibraryEntry,
  cacheSettings,
  cacheVolumesForManga,
  db,
  dropCachedLibraryEntry,
} = await import("./db.js");

/*
 * The cache writers are the single choke point every refetch goes
 * through — window focus, websocket invalidation (including the echo
 * of this device's own flush), and syncOutbox's post-flush refetch.
 * The rule under test: a row with an op waiting in its outbox table is
 * the user's intent and outranks the server snapshot. Pending `delete`
 * means the server row must not come back; any other pending op means
 * the local row survives the rewrite; everything else is server truth.
 *
 * `useUpdateVolume` documents the original report ("the user would see
 * the old value until the next refresh"). These tests replay it and
 * its siblings directly against the writers.
 */

const series = (mal_id, over = {}) => ({
  mal_id,
  name: `Series ${mal_id}`,
  volumes: 10,
  volumes_owned: 0,
  ...over,
});
const volume = (id, mal_id, over = {}) => ({
  id,
  mal_id,
  vol_num: id,
  owned: false,
  ...over,
});
const rows = (table) => table.toArray();
const byKey = (list, key) => Object.fromEntries(list.map((r) => [r[key], r]));

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("cacheLibrary", () => {
  it("replaces everything when the outbox is empty", async () => {
    await db.library.bulkPut([series(1), series(2, { name: "Stale" })]);
    await cacheLibrary([series(2, { name: "Fresh" }), series(3)]);
    const local = byKey(await rows(db.library), "mal_id");
    expect(Object.keys(local).map(Number).sort()).toEqual([2, 3]);
    expect(local[2].name).toBe("Fresh");
  });

  it("keeps an offline edit that the snapshot predates", async () => {
    // The documented report: publisher edited offline, then a refetch
    // lands before the PATCH does. Server still says "Kana".
    await db.library.put(series(1, { publisher: "Glénat" }));
    await db.outboxLibrary.put({
      mal_id: 1,
      op: "patch",
      payload: { publisher: "Glénat" },
      ts: 1,
    });
    await cacheLibrary([series(1, { publisher: "Kana" })]);
    expect((await db.library.get(1)).publisher).toBe("Glénat");
  });

  it("keeps a series added offline that the server does not know yet", async () => {
    await db.library.put(series(-1, { name: "Doujin" }));
    await db.outboxLibrary.put({
      mal_id: -1,
      op: "upsert",
      payload: series(-1),
      ts: 1,
    });
    await cacheLibrary([series(1)]);
    const local = byKey(await rows(db.library), "mal_id");
    expect(local[-1]?.name).toBe("Doujin");
    expect(local[1]).toBeTruthy();
  });

  it("does not resurrect a series with a pending delete", async () => {
    // enqueueLibraryDelete already removed the local row; the server
    // still lists the series until the DELETE is flushed.
    await db.outboxLibrary.put({ mal_id: 1, op: "delete", ts: 1 });
    await cacheLibrary([series(1), series(2)]);
    const local = byKey(await rows(db.library), "mal_id");
    expect(local[1]).toBeUndefined();
    expect(local[2]).toBeTruthy();
  });

  it("keeps the series row of a pending bulk-mark (volumes_owned was rewritten locally)", async () => {
    await db.library.put(series(1, { volumes_owned: 10 }));
    await db.outboxBulkMark.put({ mal_id: 1, owned: true, ts: 1 });
    await cacheLibrary([series(1, { volumes_owned: 3 })]);
    expect((await db.library.get(1)).volumes_owned).toBe(10);
  });

  it("still takes server truth for every row without a pending op", async () => {
    await db.library.bulkPut([
      series(1, { name: "Local 1" }),
      series(2, { name: "Local 2" }),
    ]);
    await db.outboxLibrary.put({ mal_id: 1, op: "patch", payload: {}, ts: 1 });
    await cacheLibrary([
      series(1, { name: "Server 1" }),
      series(2, { name: "Server 2" }),
    ]);
    const local = byKey(await rows(db.library), "mal_id");
    expect(local[1].name).toBe("Local 1");
    expect(local[2].name).toBe("Server 2");
  });

  it("drops a locally cached row the server removed, unless the outbox owns it", async () => {
    await db.library.bulkPut([series(1), series(2)]);
    await cacheLibrary([series(1)]);
    expect(await db.library.get(2)).toBeUndefined();
  });

  it("survives a pending op whose local row is missing", async () => {
    // Defensive: an op left behind without its row must not throw or
    // insert an undefined entry.
    await db.outboxLibrary.put({ mal_id: 9, op: "patch", payload: {}, ts: 1 });
    await expect(cacheLibrary([series(1)])).resolves.toBeUndefined();
    expect((await rows(db.library)).every(Boolean)).toBe(true);
  });

  it.each([[null], [undefined], [[]]])(
    "tolerates the empty snapshot %p",
    async (snapshot) => {
      await db.library.put(series(1));
      await db.outboxLibrary.put({
        mal_id: 1,
        op: "patch",
        payload: {},
        ts: 1,
      });
      await cacheLibrary(snapshot);
      expect(await db.library.get(1)).toBeTruthy();
    },
  );
});

describe("cacheLibraryEntry (scoped realtime refresh)", () => {
  it("writes a fresh row", async () => {
    await cacheLibraryEntry(series(1, { name: "Fresh" }));
    expect((await db.library.get(1)).name).toBe("Fresh");
  });

  it("overwrites an existing row that has no pending op", async () => {
    await db.library.put(series(1, { name: "Old" }));
    await cacheLibraryEntry(series(1, { name: "New" }));
    expect((await db.library.get(1)).name).toBe("New");
  });

  it("keeps a row with a pending edit", async () => {
    await db.library.put(series(1, { publisher: "Glénat" }));
    await db.outboxLibrary.put({ mal_id: 1, op: "patch", payload: {}, ts: 1 });
    await cacheLibraryEntry(series(1, { publisher: "Kana" }));
    expect((await db.library.get(1)).publisher).toBe("Glénat");
  });

  it("does not resurrect a row with a pending delete", async () => {
    await db.outboxLibrary.put({ mal_id: 1, op: "delete", ts: 1 });
    await cacheLibraryEntry(series(1));
    expect(await db.library.get(1)).toBeUndefined();
  });

  it("keeps a row under a pending bulk-mark", async () => {
    await db.library.put(series(1, { volumes_owned: 10 }));
    await db.outboxBulkMark.put({ mal_id: 1, owned: true, ts: 1 });
    await cacheLibraryEntry(series(1, { volumes_owned: 3 }));
    expect((await db.library.get(1)).volumes_owned).toBe(10);
  });

  it("never touches other rows", async () => {
    await db.library.put(series(2, { name: "Other" }));
    await cacheLibraryEntry(series(1));
    expect((await db.library.get(2)).name).toBe("Other");
  });

  it.each([[null], [{}], [{ name: "x" }]])(
    "ignores the malformed entry %p",
    async (e) => {
      await expect(cacheLibraryEntry(e)).resolves.toBeUndefined();
      expect(await db.library.count()).toBe(0);
    },
  );
});

describe("dropCachedLibraryEntry (scoped realtime 404)", () => {
  it("removes the row and its cached volumes", async () => {
    await db.library.put(series(1));
    await db.volumes.bulkPut([volume(1, 1), volume(2, 1), volume(9, 7)]);
    await dropCachedLibraryEntry(1);
    expect(await db.library.get(1)).toBeUndefined();
    expect(await db.volumes.where("mal_id").equals(1).count()).toBe(0);
    expect(await db.volumes.get(9)).toBeTruthy();
  });

  it("keeps a series the outbox is about to (re-)create", async () => {
    await db.library.put(series(-1));
    await db.outboxLibrary.put({
      mal_id: -1,
      op: "upsert",
      payload: {},
      ts: 1,
    });
    await dropCachedLibraryEntry(-1);
    expect(await db.library.get(-1)).toBeTruthy();
  });

  it("keeps a series under a pending bulk-mark", async () => {
    await db.library.put(series(1));
    await db.volumes.put(volume(1, 1));
    await db.outboxBulkMark.put({ mal_id: 1, owned: true, ts: 1 });
    await dropCachedLibraryEntry(1);
    expect(await db.library.get(1)).toBeTruthy();
    expect(await db.volumes.get(1)).toBeTruthy();
  });

  it("drops the row but spares a volume with its own pending op", async () => {
    await db.library.put(series(1));
    await db.volumes.bulkPut([volume(1, 1), volume(2, 1)]);
    await db.outboxVolumes.put({
      id: 2,
      mal_id: 1,
      op: "update",
      payload: {},
      ts: 1,
    });
    await dropCachedLibraryEntry(1);
    expect(await db.library.get(1)).toBeUndefined();
    expect(await db.volumes.get(1)).toBeUndefined();
    expect(await db.volumes.get(2)).toBeTruthy();
  });

  it("is a no-op for an unknown or null id", async () => {
    await db.library.put(series(1));
    await dropCachedLibraryEntry(999);
    await dropCachedLibraryEntry(null);
    expect(await db.library.count()).toBe(1);
  });
});

describe("cacheAllVolumes", () => {
  it("replaces everything when the outbox is empty", async () => {
    await db.volumes.bulkPut([volume(1, 2), volume(2, 2, { owned: false })]);
    await cacheAllVolumes([volume(2, 2, { owned: true }), volume(3, 2)]);
    const local = byKey(await rows(db.volumes), "id");
    expect(Object.keys(local).map(Number).sort()).toEqual([2, 3]);
    expect(local[2].owned).toBe(true);
  });

  it("keeps a volume with a pending update — the documented report", async () => {
    // "toggle owned" offline, then a refetch beats the PATCH.
    await db.volumes.put(volume(1, 2, { owned: true }));
    await db.outboxVolumes.put({
      id: 1,
      mal_id: 2,
      op: "update",
      payload: { owned: true },
      ts: 1,
    });
    await cacheAllVolumes([volume(1, 2, { owned: false })]);
    expect((await db.volumes.get(1)).owned).toBe(true);
  });

  it("keeps every volume of a series with a pending bulk-mark", async () => {
    await db.volumes.bulkPut([
      volume(1, 2, { owned: true }),
      volume(2, 2, { owned: true }),
      volume(3, 5, { owned: false }),
    ]);
    await db.outboxBulkMark.put({ mal_id: 2, owned: true, ts: 1 });
    await cacheAllVolumes([
      volume(1, 2, { owned: false }),
      volume(2, 2, { owned: false }),
      volume(3, 5, { owned: true }),
    ]);
    const local = byKey(await rows(db.volumes), "id");
    expect(local[1].owned).toBe(true);
    expect(local[2].owned).toBe(true);
    expect(local[3].owned).toBe(true); // other series: server wins
  });

  it("keeps a guarded volume the snapshot omits", async () => {
    await db.volumes.put(volume(1, 2, { owned: true }));
    await db.outboxVolumes.put({
      id: 1,
      mal_id: 2,
      op: "update",
      payload: {},
      ts: 1,
    });
    await cacheAllVolumes([volume(2, 2)]);
    expect(await db.volumes.get(1)).toBeTruthy();
  });

  /*
   * 削 · The series is gone locally but the DELETE hasn't flushed, so
   * the server still has it — and still hands its volumes back on the
   * next `volumes-all` refetch. `cacheLibrary` already refuses to
   * resurrect the library row; if the volume writers don't refuse the
   * tomes, they come back as orphans that nothing on screen can reach
   * and everything that counts (analytics, overdue badge, shelf
   * grouping) keeps counting.
   */
  it("does not resurrect the tomes of a series with a pending delete", async () => {
    await db.volumes.bulkPut([volume(1, 2), volume(9, 7)]);
    await db.outboxLibrary.put({ mal_id: 2, op: "delete", payload: {}, ts: 1 });
    await cacheAllVolumes([volume(1, 2, { owned: true }), volume(9, 7)]);
    const local = byKey(await rows(db.volumes), "id");
    expect(local[1]).toBeUndefined();
    expect(local[9]).toBeTruthy(); // the other series is untouched
  });

  it("drops a deleted series' tomes even when they carry their own op", async () => {
    // The delete cascade queues both; whichever guard runs, the series
    // is on its way out and must not be preserved by the volume guard.
    await db.volumes.put(volume(1, 2, { owned: true }));
    await db.outboxVolumes.put({
      id: 1,
      mal_id: 2,
      op: "update",
      payload: {},
      ts: 1,
    });
    await db.outboxLibrary.put({ mal_id: 2, op: "delete", payload: {}, ts: 2 });
    await cacheAllVolumes([volume(1, 2)]);
    expect(await db.volumes.count()).toBe(0);
  });

  it("keeps a series with a pending upsert — only deletes are barred", async () => {
    await db.outboxLibrary.put({ mal_id: 2, op: "upsert", payload: {}, ts: 1 });
    await cacheAllVolumes([volume(1, 2, { owned: true })]);
    expect((await db.volumes.get(1)).owned).toBe(true);
  });

  it("does not duplicate a volume covered by both an id op and a bulk-mark", async () => {
    await db.volumes.put(volume(1, 2, { owned: true }));
    await db.outboxVolumes.put({
      id: 1,
      mal_id: 2,
      op: "update",
      payload: {},
      ts: 1,
    });
    await db.outboxBulkMark.put({ mal_id: 2, owned: true, ts: 1 });
    await cacheAllVolumes([volume(1, 2, { owned: false })]);
    expect(await db.volumes.count()).toBe(1);
    expect((await db.volumes.get(1)).owned).toBe(true);
  });
});

describe("cacheVolumesForManga", () => {
  it("replaces one series when the outbox is empty", async () => {
    await db.volumes.bulkPut([volume(1, 2), volume(9, 7)]);
    await cacheVolumesForManga(2, [
      volume(1, 2, { owned: true }),
      volume(2, 2),
    ]);
    const local = byKey(await rows(db.volumes), "id");
    expect(local[1].owned).toBe(true);
    expect(local[2]).toBeTruthy();
    expect(local[9]).toBeTruthy(); // untouched series
  });

  it("keeps a pending volume of the targeted series", async () => {
    await db.volumes.put(volume(1, 2, { owned: true }));
    await db.outboxVolumes.put({
      id: 1,
      mal_id: 2,
      op: "update",
      payload: {},
      ts: 1,
    });
    await cacheVolumesForManga(2, [volume(1, 2, { owned: false })]);
    expect((await db.volumes.get(1)).owned).toBe(true);
  });

  it("does not resurrect one series' tomes when its delete is pending", async () => {
    await db.volumes.put(volume(1, 2));
    await db.outboxLibrary.put({ mal_id: 2, op: "delete", payload: {}, ts: 1 });
    await cacheVolumesForManga(2, [volume(1, 2), volume(2, 2)]);
    expect(await db.volumes.count()).toBe(0);
  });

  it("keeps the whole series under a pending bulk-mark", async () => {
    await db.volumes.bulkPut([
      volume(1, 2, { read_at: "x" }),
      volume(2, 2, { read_at: "x" }),
    ]);
    await db.outboxBulkMark.put({ mal_id: 2, read: true, ts: 1 });
    await cacheVolumesForManga(2, [
      volume(1, 2, { read_at: null }),
      volume(2, 2, { read_at: null }),
    ]);
    const local = byKey(await rows(db.volumes), "id");
    expect(local[1].read_at).toBe("x");
    expect(local[2].read_at).toBe("x");
  });

  it("never touches another series' rows, guarded or not", async () => {
    await db.volumes.bulkPut([volume(9, 7, { owned: true })]);
    await db.outboxVolumes.put({
      id: 9,
      mal_id: 7,
      op: "update",
      payload: {},
      ts: 1,
    });
    await cacheVolumesForManga(2, [volume(1, 2)]);
    expect((await db.volumes.get(9)).owned).toBe(true);
    expect(await db.volumes.count()).toBe(2);
  });
});

describe("cacheSettings", () => {
  it("writes the snapshot when nothing is pending", async () => {
    await cacheSettings({ theme: "light" });
    expect((await db.settings.get("user")).theme).toBe("light");
  });

  it("keeps the local choice while a settings op is pending", async () => {
    await db.settings.put({ key: "user", theme: "dark" });
    await db.outboxSettings.put({
      key: "user",
      payload: { theme: "dark" },
      ts: 1,
    });
    await cacheSettings({ theme: "light" });
    expect((await db.settings.get("user")).theme).toBe("dark");
  });

  it("ignores an empty snapshot", async () => {
    await expect(cacheSettings(null)).resolves.toBeUndefined();
    expect(await db.settings.count()).toBe(0);
  });
});

describe("cacheAuthor", () => {
  const author = (over = {}) => ({ mal_id: 4, name: "Kentaro Miura", ...over });

  it("writes the snapshot when nothing is pending", async () => {
    await cacheAuthor(author());
    expect((await db.authors.get(4)).name).toBe("Kentaro Miura");
  });

  it("keeps a pending patch", async () => {
    await db.authors.put(author({ about: "edited offline" }));
    await db.outboxAuthors.put({ mal_id: 4, op: "patch", payload: {}, ts: 1 });
    await cacheAuthor(author({ about: "server" }));
    expect((await db.authors.get(4)).about).toBe("edited offline");
  });

  it("does not resurrect a pending delete", async () => {
    await db.outboxAuthors.put({ mal_id: 4, op: "delete", ts: 1 });
    await cacheAuthor(author());
    expect(await db.authors.get(4)).toBeUndefined();
  });

  it.each([[null], [{}], [{ name: "x" }]])(
    "ignores the malformed detail %p",
    async (d) => {
      await expect(cacheAuthor(d)).resolves.toBeUndefined();
      expect(await db.authors.count()).toBe(0);
    },
  );
});

describe("cacheCoffretsForManga", () => {
  const coffret = (id, over = {}) => ({ id, name: `Box ${id}`, ...over });

  it("replaces one series' coffrets when the outbox is empty", async () => {
    await db.coffrets.bulkPut([
      { ...coffret(1), mal_id: 2 },
      { ...coffret(9), mal_id: 7 },
    ]);
    await cacheCoffretsForManga(2, [
      coffret(1, { name: "Renamed" }),
      coffret(2),
    ]);
    const local = byKey(await rows(db.coffrets), "id");
    expect(local[1].name).toBe("Renamed");
    expect(local[2].mal_id).toBe(2);
    expect(local[9]).toBeTruthy();
  });

  it("keeps a coffret created offline under its temporary id", async () => {
    await db.coffrets.put({
      ...coffret(-100, { name: "Offline box" }),
      mal_id: 2,
    });
    await db.outboxCoffrets.put({
      id: -100,
      mal_id: 2,
      op: "create",
      payload: {},
      ts: 1,
    });
    await cacheCoffretsForManga(2, [coffret(1)]);
    const local = byKey(await rows(db.coffrets), "id");
    expect(local[-100]?.name).toBe("Offline box");
    expect(local[1]).toBeTruthy();
  });

  it("keeps a pending update over the snapshot", async () => {
    await db.coffrets.put({ ...coffret(1, { name: "Local" }), mal_id: 2 });
    await db.outboxCoffrets.put({
      id: 1,
      mal_id: 2,
      op: "update",
      payload: {},
      ts: 1,
    });
    await cacheCoffretsForManga(2, [coffret(1, { name: "Server" })]);
    expect((await db.coffrets.get(1)).name).toBe("Local");
  });

  it("does not resurrect a pending delete", async () => {
    await db.outboxCoffrets.put({ id: 1, mal_id: 2, op: "delete", ts: 1 });
    await cacheCoffretsForManga(2, [coffret(1), coffret(2)]);
    const local = byKey(await rows(db.coffrets), "id");
    expect(local[1]).toBeUndefined();
    expect(local[2]).toBeTruthy();
  });

  it("ignores a null mal_id", async () => {
    await expect(
      cacheCoffretsForManga(null, [coffret(1)]),
    ).resolves.toBeUndefined();
    expect(await db.coffrets.count()).toBe(0);
  });
});

describe("end-to-end: the race the module header describes", () => {
  it("an offline edit survives a focus refetch, then a self-echo refetch, then the post-flush refetch", async () => {
    // Offline: user marks volume 1 owned. Optimistic row + outbox op.
    await db.volumes.put(volume(1, 2, { owned: true }));
    await db.outboxVolumes.put({
      id: 1,
      mal_id: 2,
      op: "update",
      payload: { owned: true },
      ts: 1,
    });

    // Back online. Focus refetch races the flush and wins — server
    // still says unowned.
    await cacheAllVolumes([volume(1, 2, { owned: false })]);
    expect((await db.volumes.get(1)).owned).toBe(true);

    // The flush lands; the server broadcasts and this device receives
    // its own echo BEFORE the op row is cleared. Snapshot now agrees.
    await cacheAllVolumes([volume(1, 2, { owned: true })]);
    expect((await db.volumes.get(1)).owned).toBe(true);

    // Op cleared; the post-flush refetch is a plain replace again.
    await db.outboxVolumes.delete(1);
    await cacheAllVolumes([volume(1, 2, { owned: true })]);
    expect((await db.volumes.get(1)).owned).toBe(true);
    expect(await db.volumes.count()).toBe(1);
  });
});
