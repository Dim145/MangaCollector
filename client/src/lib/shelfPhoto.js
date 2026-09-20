/**
 * 写 · Preparing a shelf photo for upload.
 *
 * The photo comes straight off a phone camera: twelve megapixels, four
 * megabytes, taken in a hallway on the phone's own connection. The
 * server never resizes — it only checks the magic bytes and a size
 * ceiling — so the scaling happens here, before the bytes leave the
 * device. A shelf is recognised at 1 600 px exactly as well as at
 * 4 032, and the upload goes from four megabytes to a few hundred
 * kilobytes.
 *
 * Everything degrades: a browser without `createImageBitmap`, a canvas
 * that refuses to encode, an image the decoder rejects — each falls
 * back to sending the original file, which the server is still allowed
 * to refuse. A photo that is merely large is never a reason to show the
 * reader an error.
 */

/** The long edge we scale down to. */
export const MAX_EDGE = 1600;

/** JPEG quality for the re-encode — the grain of a bookshelf hides a lot. */
export const JPEG_QUALITY = 0.82;

/**
 * The size that fits inside `max` on its longest edge, keeping the
 * aspect ratio. An image already inside the box is returned untouched:
 * upscaling a small photo would cost bytes and add nothing.
 */
export function fitWithin(width, height, max = MAX_EDGE) {
  const w = Math.floor(Number(width) || 0);
  const h = Math.floor(Number(height) || 0);
  if (w <= 0 || h <= 0) return null;
  const longest = Math.max(w, h);
  if (longest <= max) return { width: w, height: h, scaled: false };
  const ratio = max / longest;
  return {
    // A one-pixel edge is still an image; a zero-pixel one is a crash
    // in `drawImage`, and a 6000 × 3 panorama can round to it.
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
    scaled: true,
  };
}

/**
 * Scale `file` down to `maxEdge` and re-encode it as JPEG. Returns a
 * Blob to upload — the original `file` itself when nothing could be
 * done, so the caller never has to branch.
 */
export async function prepareShelfPhoto(
  file,
  { maxEdge = MAX_EDGE, quality = JPEG_QUALITY } = {},
) {
  if (!file) return null;
  if (typeof createImageBitmap !== "function") return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const box = fitWithin(bitmap.width, bitmap.height, maxEdge);
    if (!box || !box.scaled) return file;
    const canvas = document.createElement("canvas");
    canvas.width = box.width;
    canvas.height = box.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, box.width, box.height);
    const blob = await new Promise((resolve) => {
      // `toBlob` hands back null on failure rather than throwing.
      canvas.toBlob(resolve, "image/jpeg", quality);
    });
    // A re-encode that came out heavier than the original (already
    // well-compressed source, flat artwork) is work for nothing.
    if (!blob || blob.size >= file.size) return file;
    return blob;
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }
}
