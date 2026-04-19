/*
 * Barcode scanning abstraction.
 *
 * Prefers the browser-native `BarcodeDetector` API (Chrome/Edge on Android,
 * Safari iOS 17+) — zero extra bundle, native performance. Falls back to
 * `@zxing/browser` everywhere else (Firefox, older iOS, most desktops) with
 * a dynamic import so the 200 KB library only ships to clients that need it.
 *
 * The unified `startScan(video, onDetect)` returns a `stop()` function that
 * releases all resources (loop, reader, canvas).
 */

const FORMATS = ["ean_13", "ean_8", "upc_a"];

async function buildNativeDetector() {
  if (typeof window === "undefined" || !("BarcodeDetector" in window)) return null;
  try {
    // eslint-disable-next-line no-undef
    const supported = await BarcodeDetector.getSupportedFormats();
    const usable = FORMATS.filter((f) => supported.includes(f));
    if (!usable.length) return null;
    // eslint-disable-next-line no-undef
    return new BarcodeDetector({ formats: usable });
  } catch {
    return null;
  }
}

/**
 * Start detection loop on the given <video> element. `onDetect(rawValue)`
 * fires once per decoded barcode — the caller is responsible for debouncing
 * duplicate reads (we don't know which ISBN is "new" vs "same as last").
 *
 * Returns an async `stop()` that must be called before tearing the video
 * element down.
 */
export async function startScan(video, onDetect) {
  const nativeDetector = await buildNativeDetector();

  if (nativeDetector) {
    let cancelled = false;
    const loop = async () => {
      if (cancelled) return;
      try {
        if (video.readyState >= 2) {
          const codes = await nativeDetector.detect(video);
          if (codes && codes.length > 0) {
            onDetect(codes[0].rawValue);
          }
        }
      } catch {
        // Tolerate transient detection errors — just keep looping.
      }
      if (!cancelled) {
        // Throttle: ~8 scans/sec is plenty and keeps the CPU cool.
        setTimeout(loop, 120);
      }
    };
    loop();
    return async () => {
      cancelled = true;
    };
  }

  // Fallback — lazy import, only paid for when needed
  const { BrowserMultiFormatReader } = await import("@zxing/browser");
  const reader = new BrowserMultiFormatReader();
  let controls = null;
  try {
    controls = await reader.decodeFromVideoElement(video, (result) => {
      if (result) onDetect(result.getText());
    });
  } catch (err) {
    console.error("[barcode] zxing decode failed:", err?.message);
  }
  return async () => {
    try {
      controls?.stop();
    } catch {
      /* ignore */
    }
  };
}
