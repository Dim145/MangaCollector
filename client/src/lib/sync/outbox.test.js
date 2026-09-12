// A real in-memory IndexedDB so Dexie — and therefore the outbox's
// transactional coalescing — runs for real instead of against a mock.
// Must be imported before anything reaches `db.js`.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Offline for the whole suite: `triggerSync()` then no-ops, so each
// test observes the queue as the flusher would find it.
vi.mock("../connectivity.js", () => ({
  isFullyOnline: () => false,
  probeServer: vi.fn(() => Promise.resolve(false)),
}));
vi.mock("../queryClient.js", () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    removeQueries: vi.fn(),
  },
}));
vi.mock("@/utils/axios.js", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const { db } = await import("../db.js");
const axios = (await import("@/utils/axios.js")).default;
const {
  enqueueBulkMark,
  enqueueLibraryDelete,
  enqueueLibraryPatch,
  enqueueLibraryUpsert,
  enqueueVolumeUpdate,
  pendingCount,
  refetchLibraryEntry,
} = await import("./outbox.js");

/*
 * The outbox stores "the desired final state, not a log of edits"
 * (db.js header). That single sentence is the source of every
 * behaviour below: one pending op per entity, later writes merged onto
 * earlier ones rather than appended, and a delete that reaps the
 * now-pointless ops queued against the row it removes.
 */

const manga = (over = {}) => ({
  mal_id: 2,
  name: "Berserk",
  volumes: 41,
  ...over,
});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("pendingCount", () => {
  it("is zero on a clean install", async () => {
    await expect(pendingCount()).resolves.toBe(0);
  });

  it("counts across every outbox table", async () => {
    await enqueueLibraryUpsert(manga());
    await enqueueVolumeUpdate({ id: 10, mal_id: 2, owned: true });
    await enqueueBulkMark(2, { owned: true });
    await expect(pendingCount()).resolves.toBe(3);
  });
});

describe("enqueueLibraryUpsert", () => {
  it("writes the optimistic row and the pending op together", async () => {
    await enqueueLibraryUpsert(manga());
    await expect(db.library.get(2)).resolves.toMatchObject({ name: "Berserk" });
    await expect(db.outboxLibrary.get(2)).resolves.toMatchObject({
      mal_id: 2,
      op: "upsert",
    });
  });

  it("coalesces repeated upserts into a single pending op", async () => {
    await enqueueLibraryUpsert(manga({ name: "Berserk" }));
    await enqueueLibraryUpsert(manga({ name: "Berserk Deluxe" }));
    await enqueueLibraryUpsert(manga({ name: "Berserk Ultimate" }));
    await expect(db.outboxLibrary.count()).resolves.toBe(1);
  });

  it("keeps the latest payload when coalescing", async () => {
    await enqueueLibraryUpsert(manga({ name: "Berserk" }));
    await enqueueLibraryUpsert(manga({ name: "Berserk Deluxe" }));
    const op = await db.outboxLibrary.get(2);
    expect(op.payload.name).toBe("Berserk Deluxe");
  });

  it("keeps separate series in separate ops", async () => {
    await enqueueLibraryUpsert(manga({ mal_id: 2 }));
    await enqueueLibraryUpsert(manga({ mal_id: 3 }));
    await expect(db.outboxLibrary.count()).resolves.toBe(2);
  });

  it("handles a negative custom-series id", async () => {
    await enqueueLibraryUpsert(manga({ mal_id: -1 }));
    await expect(db.outboxLibrary.get(-1)).resolves.toMatchObject({
      mal_id: -1,
    });
  });
});

describe("enqueueLibraryDelete", () => {
  beforeEach(async () => {
    await enqueueLibraryUpsert(manga());
    await enqueueVolumeUpdate({ id: 10, mal_id: 2, owned: true });
    await enqueueVolumeUpdate({ id: 11, mal_id: 2, owned: true });
    await enqueueBulkMark(2, { owned: true });
  });

  it("queues a delete op", async () => {
    await enqueueLibraryDelete(2);
    await expect(db.outboxLibrary.get(2)).resolves.toMatchObject({
      op: "delete",
    });
  });

  it("drops the optimistic library row", async () => {
    await enqueueLibraryDelete(2);
    await expect(db.library.get(2)).resolves.toBeUndefined();
  });

  it("cascades to the cached volumes", async () => {
    await enqueueLibraryDelete(2);
    await expect(db.volumes.where("mal_id").equals(2).count()).resolves.toBe(0);
  });

  it("discards pending per-volume ops that would 404 after the cascade", async () => {
    await enqueueLibraryDelete(2);
    await expect(
      db.outboxVolumes.where("mal_id").equals(2).count(),
    ).resolves.toBe(0);
  });

  it("discards the pending bulk-mark op", async () => {
    await enqueueLibraryDelete(2);
    await expect(db.outboxBulkMark.get(2)).resolves.toBeUndefined();
  });

  it("replaces a pending upsert rather than queueing beside it", async () => {
    await enqueueLibraryDelete(2);
    await expect(db.outboxLibrary.count()).resolves.toBe(1);
  });

  it("leaves another series' pending ops alone", async () => {
    await enqueueLibraryUpsert(manga({ mal_id: 3 }));
    await enqueueVolumeUpdate({ id: 20, mal_id: 3, owned: true });
    await enqueueLibraryDelete(2);
    await expect(db.outboxLibrary.get(3)).resolves.toMatchObject({
      op: "upsert",
    });
    await expect(
      db.outboxVolumes.where("mal_id").equals(3).count(),
    ).resolves.toBe(1);
  });
});

describe("enqueueLibraryPatch", () => {
  beforeEach(async () => {
    await enqueueLibraryUpsert(manga());
  });

  const payload = async () => (await db.outboxLibrary.get(2)).payload;

  it.each(["publisher", "edition", "review"])("trims %s", async (key) => {
    await enqueueLibraryPatch(2, { [key]: "  Glénat  " });
    expect((await payload())[key]).toBe("Glénat");
  });

  it.each(["publisher", "edition", "review"])(
    "normalises an empty %s to null",
    async (key) => {
      await enqueueLibraryPatch(2, { [key]: "   " });
      expect((await payload())[key]).toBeNull();
    },
  );

  it("passes an explicit null straight through", async () => {
    await enqueueLibraryPatch(2, { publisher: null });
    expect((await payload()).publisher).toBeNull();
  });

  it("omits fields the caller did not mention", async () => {
    await enqueueLibraryPatch(2, { publisher: "Glénat" });
    expect("edition" in (await payload())).toBe(false);
  });

  it("coerces review_public to a boolean", async () => {
    await enqueueLibraryPatch(2, { review_public: 1 });
    expect((await payload()).review_public).toBe(true);
    await enqueueLibraryPatch(2, { review_public: 0 });
    expect((await payload()).review_public).toBe(false);
  });

  describe("image_url_jpg validation", () => {
    it.each([
      "https://cdn.myanimelist.net/x.jpg",
      "http://example.com/x.jpg",
      "/api/user/storage/poster/2",
      "",
      null,
    ])("accepts %p", async (url) => {
      await expect(
        enqueueLibraryPatch(2, { image_url_jpg: url }),
      ).resolves.not.toThrow();
    });

    it.each([
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      42,
      {},
    ])("rejects %p", async (url) => {
      // The stored value is rendered as an <img src>; anything that is
      // not http(s) or app-relative has no business reaching it.
      await expect(
        enqueueLibraryPatch(2, { image_url_jpg: url }),
      ).rejects.toThrow(/http\(s\) or app-relative/);
    });

    it("does not queue anything when validation rejects", async () => {
      const before = await db.outboxLibrary.get(2);
      await expect(
        enqueueLibraryPatch(2, { image_url_jpg: "javascript:alert(1)" }),
      ).rejects.toThrow();
      await expect(db.outboxLibrary.get(2)).resolves.toEqual(before);
    });
  });

  describe("author", () => {
    it("ships the trimmed text in the outbox payload", async () => {
      await enqueueLibraryPatch(2, { author: "  Kentaro Miura  " });
      expect((await payload()).author).toBe("Kentaro Miura");
    });

    it("writes an object stub into the local row, not raw text", async () => {
      // The optimistic read view does `row.author?.name`; a raw string
      // there would render as undefined.
      await enqueueLibraryPatch(2, { author: "Kentaro Miura" });
      const row = await db.library.get(2);
      expect(row.author).toMatchObject({ name: "Kentaro Miura" });
    });

    it.each([[null], [""], ["   "]])(
      "clears the author for %p",
      async (value) => {
        await enqueueLibraryPatch(2, { author: value });
        expect((await payload()).author).toBeNull();
        expect((await db.library.get(2)).author).toBeNull();
      },
    );
  });

  it("merges successive patches into one pending op", async () => {
    await enqueueLibraryPatch(2, { publisher: "Glénat" });
    await enqueueLibraryPatch(2, { edition: "Deluxe" });
    await expect(db.outboxLibrary.count()).resolves.toBe(1);
    const p = await payload();
    expect(p.publisher).toBe("Glénat");
    expect(p.edition).toBe("Deluxe");
  });
});

describe("enqueueVolumeUpdate", () => {
  const op = async (id) => db.outboxVolumes.get(id);
  const row = async (id) => db.volumes.get(id);

  it("writes the optimistic row and the pending op together", async () => {
    await enqueueVolumeUpdate({ id: 10, mal_id: 2, owned: true });
    await expect(row(10)).resolves.toMatchObject({ owned: true });
    await expect(op(10)).resolves.toMatchObject({ id: 10, op: "update" });
  });

  describe("read flag", () => {
    it("maps read: true to an ISO read_at on the local row", async () => {
      await enqueueVolumeUpdate({ id: 10, mal_id: 2, read: true });
      const r = await row(10);
      expect(r.read_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("maps read: false to a null read_at", async () => {
      await enqueueVolumeUpdate({ id: 10, mal_id: 2, read: true });
      await enqueueVolumeUpdate({ id: 10, mal_id: 2, read: false });
      expect((await row(10)).read_at).toBeNull();
    });

    it("leaves read_at untouched when read is not part of the patch", async () => {
      await enqueueVolumeUpdate({ id: 10, mal_id: 2, read: true });
      const before = (await row(10)).read_at;
      await enqueueVolumeUpdate({ id: 10, mal_id: 2, owned: true });
      expect((await row(10)).read_at).toBe(before);
    });
  });

  describe("merging", () => {
    it("keeps columns the new patch did not touch", async () => {
      await enqueueVolumeUpdate({
        id: 10,
        mal_id: 2,
        price: 7.99,
        store: "Fnac",
      });
      await enqueueVolumeUpdate({ id: 10, mal_id: 2, owned: true });
      const r = await row(10);
      expect(r.price).toBe(7.99);
      expect(r.store).toBe("Fnac");
      expect(r.owned).toBe(true);
    });

    it("does not lose an earlier flag when a second patch lands first", async () => {
      // The documented regression: "toggle read" then "toggle owned"
      // before the flusher fires used to clobber `read` with undefined.
      await enqueueVolumeUpdate({ id: 10, mal_id: 2, read: true });
      await enqueueVolumeUpdate({ id: 10, mal_id: 2, owned: true });
      const pending = await op(10);
      expect(pending.payload.read).toBe(true);
      expect(pending.payload.owned).toBe(true);
    });

    it("lets the newer value win on a field both patches set", async () => {
      await enqueueVolumeUpdate({ id: 10, mal_id: 2, price: 7.99 });
      await enqueueVolumeUpdate({ id: 10, mal_id: 2, price: 9.99 });
      expect((await op(10)).payload.price).toBe(9.99);
    });

    it("keeps a single pending op per volume", async () => {
      for (let i = 0; i < 5; i++) {
        await enqueueVolumeUpdate({ id: 10, mal_id: 2, price: i });
      }
      await expect(db.outboxVolumes.count()).resolves.toBe(1);
    });

    it("keeps separate volumes in separate ops", async () => {
      await enqueueVolumeUpdate({ id: 10, mal_id: 2, owned: true });
      await enqueueVolumeUpdate({ id: 11, mal_id: 2, owned: true });
      await expect(db.outboxVolumes.count()).resolves.toBe(2);
    });
  });

  describe("loans", () => {
    it("mirrors a lend onto the local row", async () => {
      await enqueueVolumeUpdate({
        id: 10,
        mal_id: 2,
        loan: { to: "Alex", due_at: "2026-10-01" },
      });
      const r = await row(10);
      expect(r.loaned_to).toBe("Alex");
      expect(r.loan_due_at).toBe("2026-10-01");
    });

    it("stamps loan_started_at on the first lend", async () => {
      await enqueueVolumeUpdate({ id: 10, mal_id: 2, loan: { to: "Alex" } });
      expect((await row(10)).loan_started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("preserves loan_started_at when the loan is edited", async () => {
      // Mirrors the server's "preserve on edit" rule in set_loan.
      await enqueueVolumeUpdate({ id: 10, mal_id: 2, loan: { to: "Alex" } });
      const started = (await row(10)).loan_started_at;
      await enqueueVolumeUpdate({
        id: 10,
        mal_id: 2,
        loan: { to: "Alex", due_at: "2026-12-01" },
      });
      expect((await row(10)).loan_started_at).toBe(started);
    });

    it("clears the whole loan triplet on return", async () => {
      await enqueueVolumeUpdate({
        id: 10,
        mal_id: 2,
        loan: { to: "Alex", due_at: "2026-10-01" },
      });
      await enqueueVolumeUpdate({ id: 10, mal_id: 2, loan: null });
      const r = await row(10);
      expect(r.loaned_to).toBeNull();
      expect(r.loan_started_at).toBeNull();
      expect(r.loan_due_at).toBeNull();
    });

    it("carries the raw loan patch in the outbox payload", async () => {
      await enqueueVolumeUpdate({ id: 10, mal_id: 2, loan: null });
      expect((await op(10)).payload.loan).toBeNull();
    });
  });
});

describe("refetchLibraryEntry (scoped realtime refresh)", () => {
  // The endpoint answers `Vec<LibraryEntry>`: one row when the series is
  // in the library, an empty array once it has been deleted — with a
  // 200 in both cases. Handing the raw array to the cache writer made
  // the whole scoped path a silent no-op; these pin the unwrap.
  it("caches the single row the server returns", async () => {
    axios.get.mockResolvedValueOnce({ data: [manga({ name: "Fresh" })] });
    await expect(refetchLibraryEntry(2)).resolves.toMatchObject({
      name: "Fresh",
    });
    await expect(db.library.get(2)).resolves.toMatchObject({ name: "Fresh" });
  });

  it("drops the local row and its volumes when the server returns an empty array", async () => {
    await db.library.put(manga());
    await db.volumes.bulkPut([
      { id: 1, mal_id: 2, vol_num: 1 },
      { id: 2, mal_id: 2, vol_num: 2 },
    ]);
    axios.get.mockResolvedValueOnce({ data: [] });
    await expect(refetchLibraryEntry(2)).resolves.toBeNull();
    await expect(db.library.get(2)).resolves.toBeUndefined();
    await expect(db.volumes.where("mal_id").equals(2).count()).resolves.toBe(0);
  });

  it("treats a 404 the same way", async () => {
    await db.library.put(manga());
    axios.get.mockRejectedValueOnce({ response: { status: 404 } });
    await expect(refetchLibraryEntry(2)).resolves.toBeNull();
    await expect(db.library.get(2)).resolves.toBeUndefined();
  });

  it("does not drop a row the outbox still owns", async () => {
    await enqueueLibraryUpsert(manga({ mal_id: -9, name: "Offline add" }));
    axios.get.mockResolvedValueOnce({ data: [] });
    await refetchLibraryEntry(-9);
    await expect(db.library.get(-9)).resolves.toMatchObject({
      name: "Offline add",
    });
  });

  it("rethrows a non-404 failure so the caller can fall back", async () => {
    axios.get.mockRejectedValueOnce({ response: { status: 500 } });
    await expect(refetchLibraryEntry(2)).rejects.toBeTruthy();
  });

  it("still accepts a bare object, should the endpoint ever change shape", async () => {
    axios.get.mockResolvedValueOnce({ data: manga({ name: "Bare" }) });
    await refetchLibraryEntry(2);
    await expect(db.library.get(2)).resolves.toMatchObject({ name: "Bare" });
  });
});
