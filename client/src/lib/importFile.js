/*
 * 封 · Read an import file as text, unpacking gzip in the browser.
 *
 * MyAnimeList hands out its list export as `mangalist_….xml.gz`; asking
 * the user to unzip it first is one more step than most will take, so
 * the file is sniffed by its magic bytes (not its name — browsers are
 * inconsistent about `.gz` MIME types) and inflated with the platform
 * `DecompressionStream`. Plain files pass straight through.
 */

/** True when the buffer starts with the gzip member header 1f 8b. */
export function looksGzipped(bytes) {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Ceiling on what a list export can weigh. A MyAnimeList XML for a
 * 5 000-series library is under 3 MB; anything past this is either not
 * a list or is meant to make the tab fall over, and both deserve a
 * message rather than an out-of-memory crash. Checked on the file AND
 * on the inflated bytes, since gzip hides the real size.
 */
export const MAX_IMPORT_BYTES = 32 * 1024 * 1024;

export async function readImportFile(file) {
  if (file?.size > MAX_IMPORT_BYTES) throw new Error("import-too-large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksGzipped(bytes)) return new TextDecoder("utf-8").decode(bytes);
  if (typeof DecompressionStream === "undefined") {
    throw new Error("gzip-unsupported");
  }
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const inflated = source.pipeThrough(new DecompressionStream("gzip"));
  const blob = await new Response(inflated).blob();
  if (blob.size > MAX_IMPORT_BYTES) throw new Error("import-too-large");
  return await blob.text();
}
