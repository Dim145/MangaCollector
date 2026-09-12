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

export async function readImportFile(file) {
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
  return await new Response(inflated).text();
}
