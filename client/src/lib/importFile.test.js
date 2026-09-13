import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { looksGzipped, readImportFile } from "./importFile.js";

/*
 * The MAL export arrives gzipped; a user who drops the file as
 * downloaded must get the same text a user who unzipped it first
 * would. Sniffing is by magic bytes, so the file name is irrelevant.
 */

const XML =
  '<?xml version="1.0"?><myanimelist><manga><manga_title><![CDATA[Élan &amp; co]]></manga_title></manga></myanimelist>';

describe("looksGzipped", () => {
  /*
   * Both header bytes, in that order, and two bytes are enough. A file
   * that carries only one of them is not gzip, which is the case a
   * test built from "neither byte matches" never reaches.
   */
  it("recognises the gzip member header only", () => {
    expect(looksGzipped(new Uint8Array([0x1f, 0x8b, 0x08]))).toBe(true);
    expect(looksGzipped(new Uint8Array([0x1f, 0x8b]))).toBe(true);
    expect(looksGzipped(new Uint8Array([0x1f, 0x00]))).toBe(false);
    expect(looksGzipped(new Uint8Array([0x00, 0x8b]))).toBe(false);
    expect(looksGzipped(new Uint8Array([0x8b, 0x1f]))).toBe(false);
    expect(looksGzipped(new Uint8Array([0x3c, 0x3f]))).toBe(false);
    expect(looksGzipped(new Uint8Array([0x1f]))).toBe(false);
    expect(looksGzipped(new Uint8Array([]))).toBe(false);
  });
});

describe("readImportFile", () => {
  it("returns plain text files as they are", async () => {
    const file = new File([XML], "mangalist.xml", { type: "text/xml" });
    expect(await readImportFile(file)).toBe(XML);
  });

  it("inflates a gzipped file whatever its name says", async () => {
    const gz = gzipSync(Buffer.from(XML, "utf-8"));
    const file = new File([gz], "whatever.bin", {
      type: "application/octet-stream",
    });
    expect(await readImportFile(file)).toBe(XML);
  });

  it("says so when the platform cannot inflate", async () => {
    const saved = globalThis.DecompressionStream;
    delete globalThis.DecompressionStream;
    try {
      const gz = gzipSync(Buffer.from(XML, "utf-8"));
      await expect(readImportFile(new File([gz], "a.gz"))).rejects.toThrow(
        "gzip-unsupported",
      );
    } finally {
      globalThis.DecompressionStream = saved;
    }
  });

  it("keeps non-ASCII text intact through both paths", async () => {
    const text = "漫画 · Élan — 巻";
    expect(await readImportFile(new File([text], "a.txt"))).toBe(text);
    const gz = gzipSync(Buffer.from(text, "utf-8"));
    expect(await readImportFile(new File([gz], "a.gz"))).toBe(text);
  });
});
