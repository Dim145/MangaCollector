import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * 同 · The rule this pins: an answer the client already holds is not
 * parsed again and not written again. The server tags every JSON GET
 * with a weak ETag, so a reload gets a 304 and the browser hands back
 * the same bytes with the same tag — 1 986 rows that were already in
 * Dexie. Rewriting them cost about 1 400 IndexedDB writes and a
 * full-table clear on every page load.
 *
 * And the guard that makes it safe: the skip only applies while the
 * local table still holds rows. A cache wiped for any reason — another
 * account signing in, a purge — must be refilled even though the
 * server's answer has not changed.
 */

const get = vi.fn();
const cacheLibrary = vi.fn(async () => {});
const cacheAllVolumes = vi.fn(async () => {});
const applyVolumesDelta = vi.fn(async () => {});
const cacheSettings = vi.fn(async () => {});
let libraryCount = 0;
let volumeCount = 0;

vi.mock("@/utils/axios.js", () => ({ default: { get: (...a) => get(...a) } }));
vi.mock("@/lib/db.js", () => ({
  cacheLibrary: (...a) => cacheLibrary(...a),
  cacheAllVolumes: (...a) => cacheAllVolumes(...a),
  applyVolumesDelta: (...a) => applyVolumesDelta(...a),
  cacheSettings: (...a) => cacheSettings(...a),
  db: {
    library: { count: async () => libraryCount },
    volumes: { count: async () => volumeCount },
  },
}));

const { allVolumesQuery, libraryQuery, settingsQuery } = await import(
  "./coreQueries.js"
);

const rows = [{ id: 1 }, { id: 2 }];
const answer = (etag) => ({ data: JSON.stringify(rows), headers: { etag } });

beforeEach(() => {
  get.mockReset();
  cacheLibrary.mockClear();
  cacheAllVolumes.mockClear();
  applyVolumesDelta.mockClear();
  libraryCount = 0;
  volumeCount = 0;
  localStorage.clear();
});

describe("the volumes read", () => {
  it("asks for text, not JSON, so an unchanged answer is never parsed", async () => {
    get.mockResolvedValue(answer('W/"abc"'));
    await allVolumesQuery.queryFn();
    const [url, options] = get.mock.calls[0];
    expect(url).toBe("/api/user/volume");
    expect(options.responseType).toBe("text");
    // Left to axios, the megabyte would be parsed before anyone could
    // look at the tag.
    expect(options.transformResponse[0]("raw")).toBe("raw");
  });

  it("writes the first time and remembers the tag", async () => {
    get.mockResolvedValue(answer('W/"abc"'));
    const out = await allVolumesQuery.queryFn();
    expect(cacheAllVolumes).toHaveBeenCalledWith(rows);
    expect(out).toEqual(rows);
    expect(localStorage.getItem("mc:etag:volumes")).toBe('W/"abc"');
  });

  it("writes nothing the second time, when the tag and the rows agree", async () => {
    get.mockResolvedValue(answer('W/"abc"'));
    await allVolumesQuery.queryFn();
    volumeCount = rows.length;
    cacheAllVolumes.mockClear();

    const out = await allVolumesQuery.queryFn();
    expect(cacheAllVolumes).not.toHaveBeenCalled();
    expect(out).toEqual({ unchanged: true, rows: 2 });
  });

  it("writes again when the answer changed", async () => {
    get.mockResolvedValue(answer('W/"abc"'));
    await allVolumesQuery.queryFn();
    volumeCount = rows.length;
    cacheAllVolumes.mockClear();

    get.mockResolvedValue(answer('W/"def"'));
    await allVolumesQuery.queryFn();
    expect(cacheAllVolumes).toHaveBeenCalledWith(rows);
    expect(localStorage.getItem("mc:etag:volumes")).toBe('W/"def"');
  });

  it("writes again when the local cache is empty, tag or no tag", async () => {
    get.mockResolvedValue(answer('W/"abc"'));
    await allVolumesQuery.queryFn();
    cacheAllVolumes.mockClear();
    volumeCount = 0; // wiped: another account signed in

    await allVolumesQuery.queryFn();
    expect(cacheAllVolumes).toHaveBeenCalledWith(rows);
  });

  it("writes every time when the server sends no tag", async () => {
    get.mockResolvedValue({ data: JSON.stringify(rows), headers: {} });
    await allVolumesQuery.queryFn();
    volumeCount = rows.length;
    cacheAllVolumes.mockClear();
    await allVolumesQuery.queryFn();
    expect(cacheAllVolumes).toHaveBeenCalledWith(rows);
  });
});

describe("the other two reads", () => {
  it("gives the library its own tag, not the volumes' one", async () => {
    get.mockResolvedValue(answer('W/"abc"'));
    await allVolumesQuery.queryFn();
    await libraryQuery.queryFn();
    expect(localStorage.getItem("mc:etag:library")).toBe('W/"abc"');
    expect(cacheLibrary).toHaveBeenCalledWith(rows);

    // Same tag value, different resource: the library still skips on
    // its own key once its own rows are there.
    libraryCount = 2;
    cacheLibrary.mockClear();
    await libraryQuery.queryFn();
    expect(cacheLibrary).not.toHaveBeenCalled();
  });

  it("leaves the settings read alone — it is a few hundred bytes", async () => {
    get.mockResolvedValue({ data: { theme: "dark" } });
    const out = await settingsQuery.queryFn();
    expect(get).toHaveBeenCalledWith("/api/user/settings");
    expect(cacheSettings).toHaveBeenCalledWith({ theme: "dark" });
    expect(out).toEqual({ theme: "dark" });
  });
});

/*
 * 差 · Once a full read has said which revision it was taken at, the
 * next refresh asks only for what changed after it — and falls back to
 * a full read whenever the delta cannot be trusted.
 */
describe("the volumes delta", () => {
  const full = (rev) => ({ data: JSON.stringify(rows), headers: { etag: 'W/"abc"', "x-volume-rev": rev } });

  it("remembers the revision a full read was taken at, then asks for what changed after it", async () => {
    get.mockResolvedValueOnce(full("41"));
    await allVolumesQuery.queryFn();
    expect(localStorage.getItem("mc:etag:volumes-rev")).toBe("41");

    volumeCount = 2;
    const delta = { rev: 43, changed: [{ id: 2, owned: true }], ids: [1, 2] };
    get.mockResolvedValueOnce({ data: delta, headers: {} });
    const out = await allVolumesQuery.queryFn();
    expect(get.mock.calls[1]).toEqual(["/api/user/volume", { params: { since: "41" } }]);
    expect(applyVolumesDelta).toHaveBeenCalledWith(delta);
    expect(cacheAllVolumes).toHaveBeenCalledTimes(1); // only the first, full read
    expect(out).toEqual({ delta: true, changed: 1, rows: 2 });
    expect(localStorage.getItem("mc:etag:volumes-rev")).toBe("43");
  });

  it("reads everything when the device holds no volumes, whatever revision it remembers", async () => {
    localStorage.setItem("mc:etag:volumes-rev", "41");
    volumeCount = 0;
    get.mockResolvedValueOnce(full("44"));
    await allVolumesQuery.queryFn();
    expect(get.mock.calls[0][1]).toMatchObject({ responseType: "text" });
    expect(applyVolumesDelta).not.toHaveBeenCalled();
    expect(localStorage.getItem("mc:etag:volumes-rev")).toBe("44");
  });

  it("starts again from a full read when the server refuses the revision", async () => {
    localStorage.setItem("mc:etag:volumes-rev", "41");
    volumeCount = 2;
    get
      .mockRejectedValueOnce({ response: { status: 400 } })
      .mockResolvedValueOnce(full("7"));
    await allVolumesQuery.queryFn();
    expect(get).toHaveBeenCalledTimes(2);
    expect(cacheAllVolumes).toHaveBeenCalledWith(rows);
    expect(localStorage.getItem("mc:etag:volumes-rev")).toBe("7");
  });

  it("starts again from a full read when an older server answers with the full list", async () => {
    localStorage.setItem("mc:etag:volumes-rev", "41");
    volumeCount = 2;
    get
      .mockResolvedValueOnce({ data: rows, headers: {} })
      .mockResolvedValueOnce({ data: JSON.stringify(rows), headers: { etag: 'W/"zz"' } });
    await allVolumesQuery.queryFn();
    expect(applyVolumesDelta).not.toHaveBeenCalled();
    expect(cacheAllVolumes).toHaveBeenCalledWith(rows);
    // No revision on that answer: the next refresh is a full read too.
    expect(localStorage.getItem("mc:etag:volumes-rev")).toBeNull();
  });

  it("lets a network failure through rather than guessing", async () => {
    localStorage.setItem("mc:etag:volumes-rev", "41");
    volumeCount = 2;
    get.mockRejectedValueOnce({ code: "ERR_NETWORK" });
    await expect(allVolumesQuery.queryFn()).rejects.toEqual({ code: "ERR_NETWORK" });
    expect(localStorage.getItem("mc:etag:volumes-rev")).toBe("41");
  });
});
