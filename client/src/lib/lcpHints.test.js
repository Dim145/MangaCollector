import { beforeEach, describe, expect, it } from "vitest";
import {
  LCP_HINT_PREFIX,
  clearLcpHints,
  readLcpCovers,
  rememberLcpCover,
} from "./lcpHints.js";

const A = {
  src: "https://uploads.mangadex.org/covers/a/b.jpg.512.jpg",
  srcset: "https://uploads.mangadex.org/covers/a/b.jpg.256.jpg 256w, https://uploads.mangadex.org/covers/a/b.jpg.512.jpg 512w",
  sizes: "192px",
};
const B = { src: "/api/user/storage/poster/4" };

beforeEach(() => localStorage.clear());

describe("LCP cover hints", () => {
  it("keeps the covers in the order the page drew them", () => {
    rememberLcpCover("/dashboard", 1, B);
    rememberLcpCover("/dashboard", 0, A);
    expect(readLcpCovers("/dashboard")).toEqual([A, B]);
  });

  it("keeps two covers per page and ignores anything past them", () => {
    rememberLcpCover("/", 2, A);
    rememberLcpCover("/", -1, A);
    rememberLcpCover("/", 0.5, A);
    expect(readLcpCovers("/")).toEqual([]);
  });

  it("replaces a cover that changed and keeps pages apart", () => {
    rememberLcpCover("/", 0, A);
    rememberLcpCover("/", 0, B);
    rememberLcpCover("/dashboard", 0, A);
    expect(readLcpCovers("/")[0]).toEqual(B);
    expect(readLcpCovers("/dashboard")[0]).toEqual(A);
  });

  it("survives a corrupted entry", () => {
    localStorage.setItem(`${LCP_HINT_PREFIX}/`, "{not json");
    expect(readLcpCovers("/")).toEqual([]);
    rememberLcpCover("/", 0, A);
    expect(readLcpCovers("/")).toEqual([A, null]);
  });

  it("keeps what the <img> said, so a preload chooses as it does", () => {
    rememberLcpCover("/", 0, { ...A, unrelated: true });
    expect(readLcpCovers("/")[0]).toEqual(A);
    rememberLcpCover("/", 1, { src: "", srcset: A.srcset });
    expect(readLcpCovers("/")[1]).toBeNull();
  });

  it("is wiped with the rest of the account's traces", () => {
    rememberLcpCover("/", 0, A);
    rememberLcpCover("/dashboard", 0, B);
    localStorage.setItem("mc:theme", "dark");
    clearLcpHints();
    expect(readLcpCovers("/")).toEqual([]);
    expect(readLcpCovers("/dashboard")).toEqual([]);
    expect(localStorage.getItem("mc:theme")).toBe("dark");
  });
});

/*
 * The inline script in `index.html` reads these keys by name, before any
 * module exists to import them from — so its spelling is pinned here.
 */
describe("the index.html preload script", () => {
  it("reads the same keys the app writes", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const html = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../index.html"),
      "utf8",
    );
    expect(html).toContain(`localStorage.getItem("${LCP_HINT_PREFIX}" + path)`);
    // The dashboard's remembered view (see `components/Dashboard.jsx`).
    expect(html).toContain(`sessionStorage.getItem("mc:dashboard:view")`);
    const dashboard = fs.readFileSync(
      path.resolve(import.meta.dirname, "../components/Dashboard.jsx"),
      "utf8",
    );
    expect(dashboard).toContain(`DASHBOARD_STATE_KEY = "mc:dashboard:view"`);
  });
});
