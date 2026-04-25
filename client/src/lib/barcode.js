/*
 * Barcode scanning abstraction.
 *
 * Uses the browser-native `BarcodeDetector` API where available
 * (Chrome/Edge on all platforms, Safari iOS 17+, macOS Sonoma) and
 * falls back to a WASM polyfill on browsers that lack it (Firefox,
 * older iOS).
 *
 * The polyfill is the `barcode-detector` package, which wraps a
 * tiny ZXing WASM build behind the same `BarcodeDetector` interface.
 * It replaces the previous `@zxing/browser` + `@zxing/library` pair
 * (last npm release 2024-08, ~20 months stale) with a single,
 * actively maintained dep (last release 3 weeks ago at audit time)
 * that rides the spec API directly — same call shape on every
 * browser, no `if (native) ... else { import zxing }` branch.
 *
 * Bundle impact: the polyfill module is ~262 KB unpacked but only
 * pulled in when actually instantiated (lazy import below). Browsers
 * with native support never load it.
 *
 * The unified `startScan(video, onDetect)` returns a `stop()` that
 * releases the detection loop.
 */

const FORMATS = ["ean_13", "ean_8", "upc_a"];

async function getDetectorClass() {
  // Prefer the native class — zero polyfill download for browsers
  // that support it. We probe both `window.BarcodeDetector` and the
  // format-support API since some browsers expose the constructor
  // but stub out `getSupportedFormats`.
  if (typeof window !== "undefined" && "BarcodeDetector" in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      if (FORMATS.some((f) => supported.includes(f))) {
        return window.BarcodeDetector;
      }
    } catch {
      /* fall through to polyfill */
    }
  }

  // Polyfill path. `pure` re-exports the BarcodeDetector class
  // without registering it as a global side effect — cleaner than
  // the polyfill bundle for our explicit getDetectorClass() pattern.
  const { BarcodeDetector } = await import("barcode-detector/pure");
  return BarcodeDetector;
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
  const Detector = await getDetectorClass();
  let detector;
  try {
    detector = new Detector({ formats: FORMATS });
  } catch (err) {
    console.error("[barcode] detector construction failed:", err?.message);
    return async () => {};
  }

  let cancelled = false;
  const loop = async () => {
    if (cancelled) return;
    try {
      if (video.readyState >= 2) {
        const codes = await detector.detect(video);
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
