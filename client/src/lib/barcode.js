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

/**
 * 写 · Read a barcode out of a still image — a photo just taken, or a
 * file picked on a machine with no camera at all. Same detector, same
 * formats, one shot instead of a loop.
 *
 * A 12 MP phone photo is often *too* big for the decoders: the bars end
 * up thinner than the sampling grid. When the full-size pass finds
 * nothing we retry once on a downscaled copy, which is what usually
 * lands.
 */
export async function detectFromImage(source) {
  const Detector = await getDetectorClass();
  let detector;
  try {
    detector = new Detector({ formats: FORMATS });
  } catch (err) {
    console.error("[barcode] detector construction failed:", err?.message);
    return null;
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    return null;
  }

  const read = async (image) => {
    try {
      const codes = await detector.detect(image);
      return codes?.[0]?.rawValue ?? null;
    } catch {
      return null;
    }
  };

  try {
    const direct = await read(bitmap);
    if (direct) return direct;
    return await read(await downscale(bitmap, 1600));
  } finally {
    bitmap.close?.();
  }
}

/** A copy no wider or taller than `max`, or the original when it fits. */
async function downscale(bitmap, max) {
  const ratio = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  if (ratio === 1) return bitmap;
  const width = Math.round(bitmap.width * ratio);
  const height = Math.round(bitmap.height * ratio);
  try {
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height });
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    return canvas;
  } catch {
    return bitmap;
  }
}

/**
 * 灯 · What this particular camera can do beyond pointing: a torch for a
 * dark spine, a zoom for a barcode the lens will not come close enough
 * to. Both are optional everywhere and absent on most desktops, so the
 * caller shows a control only when the capability is real.
 *
 * `applyConstraints` rejects on hardware that advertises a capability it
 * cannot actually honour, so every setter reports success rather than
 * throwing at the UI.
 */
export function cameraControls(track) {
  const caps =
    typeof track?.getCapabilities === "function"
      ? (track.getCapabilities() ?? {})
      : {};
  const settings =
    typeof track?.getSettings === "function" ? (track.getSettings() ?? {}) : {};

  const zoomCap = caps.zoom;
  const zoom =
    zoomCap &&
    Number.isFinite(zoomCap.min) &&
    Number.isFinite(zoomCap.max) &&
    zoomCap.max > zoomCap.min
      ? {
          min: zoomCap.min,
          max: zoomCap.max,
          step:
            Number.isFinite(zoomCap.step) && zoomCap.step > 0
              ? zoomCap.step
              : 0.1,
          current: Number.isFinite(settings.zoom) ? settings.zoom : zoomCap.min,
        }
      : null;

  const apply = async (advanced) => {
    try {
      await track.applyConstraints({ advanced: [advanced] });
      return true;
    } catch {
      return false;
    }
  };

  return {
    torch: Boolean(caps.torch),
    zoom,
    setTorch: (on) => apply({ torch: Boolean(on) }),
    setZoom: (value) => apply({ zoom: value }),
  };
}
