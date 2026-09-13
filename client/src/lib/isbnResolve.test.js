import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", () => ({
  db: {
    isbnCache: {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
    },
  },
}));
vi.mock("@/utils/axios.js", () => ({ default: { get: vi.fn() } }));

const axios = (await import("@/utils/axios.js")).default;
const { lookupISBN } = await import("./isbn.js");

/*
 * Resolution order: the server (shared cache + four catalogues) answers
 * for everyone; only when it cannot be reached does the browser ask the
 * CORS-friendly catalogues itself. A server "not found" is final.
 */

const ISBN = "9780306406157";
const SERVER_HIT = {
  found: true,
  source: "bnf",
  book: {
    isbn: ISBN,
    title: "One Piece, Vol. 12",
    authors: ["Eiichiro Oda"],
    publisher: "Glénat",
    page_count: 192,
    language: "fre",
    cover: "https://covers.openlibrary.org/b/id/1-L.jpg",
    price: { amount: 7.2, currency: "EUR" },
    source: "bnf",
  },
};

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lookupISBN — server first", () => {
  it("uses the server's answer and never touches the catalogues itself", async () => {
    axios.get.mockResolvedValueOnce({ data: SERVER_HIT });
    const r = await lookupISBN("978-0-306-40615-7");
    expect(axios.get).toHaveBeenCalledWith(
      `/api/user/isbn/${ISBN}`,
      expect.any(Object),
    );
    expect(r).toMatchObject({
      isbn: ISBN,
      title: "One Piece",
      volume: 12,
      publisher: "Glénat",
      pageCount: 192,
      thumbnail: "https://covers.openlibrary.org/b/id/1-L.jpg",
      price: { amount: 7.2, currency: "EUR", source: "bnf" },
      source: "bnf",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a server 'not found' as final", async () => {
    axios.get.mockResolvedValueOnce({ data: { found: false, book: null } });
    expect(await lookupISBN(ISBN)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid ISBN before any request", async () => {
    await expect(lookupISBN("1234567890123")).rejects.toThrow("Invalid ISBN");
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe("lookupISBN — the server is unreachable", () => {
  it("falls back to Google Books directly", async () => {
    axios.get.mockRejectedValueOnce(new Error("Network Error"));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        items: [
          {
            volumeInfo: {
              title: "Berserk, Vol. 3",
              authors: ["Kentaro Miura"],
              pageCount: 240,
            },
            saleInfo: { listPrice: { amount: 14.99, currencyCode: "USD" } },
          },
        ],
      }),
    );
    const r = await lookupISBN(ISBN);
    expect(fetchMock.mock.calls[0][0]).toContain(
      "googleapis.com/books/v1/volumes",
    );
    expect(r).toMatchObject({
      title: "Berserk",
      volume: 3,
      source: "google_books",
    });
    expect(r.price).toEqual({
      amount: 14.99,
      currency: "USD",
      source: "google_books",
    });
  });

  it("walks on to Open Library when Google has nothing", async () => {
    axios.get.mockRejectedValueOnce({ code: "ECONNABORTED" });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { totalItems: 0 }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          docs: [
            {
              title: "Vagabond",
              subtitle: "Tome 5",
              author_name: ["Takehiko Inoue"],
              publisher: ["Tonkam"],
              language: ["fre"],
              cover_i: 777,
            },
          ],
        }),
      );
    const r = await lookupISBN(ISBN);
    expect(fetchMock.mock.calls[1][0]).toContain("openlibrary.org/search.json");
    expect(r).toMatchObject({
      title: "Vagabond",
      volume: 5,
      publisher: "Tonkam",
      thumbnail: "https://covers.openlibrary.org/b/id/777-L.jpg",
      source: "open_library",
    });
  });

  it("lets openBD rescue a Google rate limit, and only then reports the limit", async () => {
    axios.get.mockRejectedValueOnce(new Error("Network Error"));
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(jsonResponse(200, { docs: [] }))
      .mockResolvedValueOnce(
        jsonResponse(200, [
          {
            summary: {
              title: "ONE PIECE 1",
              author: "尾田栄一郎／著",
              publisher: "集英社",
            },
          },
        ]),
      );
    const r = await lookupISBN(ISBN);
    expect(r).toMatchObject({
      source: "openbd",
      authors: ["尾田栄一郎"],
      language: "ja",
    });

    // The same limit with nothing else knowing the book → it surfaces.
    axios.get.mockRejectedValueOnce(new Error("Network Error"));
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { docs: [] }))
      .mockResolvedValueOnce(jsonResponse(200, [null]));
    await expect(lookupISBN("9780804429573")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });
});
