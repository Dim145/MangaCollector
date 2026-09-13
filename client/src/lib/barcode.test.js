import { describe, expect, it, vi } from "vitest";
import { afterEach, beforeEach } from "vitest";
import { cameraControls, detectFromImage, startScan } from "./barcode.js";

/**
 * 灯 · `cameraControls` reads what a camera says it can do. Phones lie
 * in both directions — a capability that is absent, present but empty,
 * or advertised and then refused by `applyConstraints` — so the shape
 * it returns is what the UI trusts to decide whether to show a control.
 */
const track = (
  capabilities,
  settings = {},
  apply = vi.fn().mockResolvedValue(),
) => ({
  getCapabilities: () => capabilities,
  getSettings: () => settings,
  applyConstraints: apply,
});

describe("cameraControls", () => {
  it("reports nothing on a camera that offers nothing", () => {
    const c = cameraControls(track({}));
    expect(c.torch).toBe(false);
    expect(c.zoom).toBeNull();
  });

  it("reports nothing on a track that has no capability API at all", () => {
    const c = cameraControls({});
    expect(c.torch).toBe(false);
    expect(c.zoom).toBeNull();
  });

  it("ignores a zoom range that cannot move", () => {
    expect(cameraControls(track({ zoom: { min: 1, max: 1 } })).zoom).toBeNull();
    expect(cameraControls(track({ zoom: { min: 1 } })).zoom).toBeNull();
  });

  it("keeps the current zoom and defaults a missing step", () => {
    const c = cameraControls(
      track({ zoom: { min: 1, max: 4 } }, { zoom: 2.5 }),
    );
    expect(c.zoom).toEqual({ min: 1, max: 4, step: 0.1, current: 2.5 });
  });

  it("applies torch and zoom through advanced constraints", async () => {
    const apply = vi.fn().mockResolvedValue();
    const c = cameraControls(track({ torch: true }, {}, apply));
    expect(c.torch).toBe(true);
    await expect(c.setTorch(true)).resolves.toBe(true);
    expect(apply).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    await c.setZoom(3);
    expect(apply).toHaveBeenLastCalledWith({ advanced: [{ zoom: 3 }] });
  });

  it("reports a refusal instead of throwing at the UI", async () => {
    const apply = vi.fn().mockRejectedValue(new Error("not supported"));
    const c = cameraControls(track({ torch: true }, {}, apply));
    await expect(c.setTorch(true)).resolves.toBe(false);
  });
});

/**
 * 写 · `detectFromImage` and `startScan` both run against whatever
 * barcode reader the browser provides. Here that reader is a stub, so
 * what is under test is our own part: which image gets read, how many
 * times, and what comes back when nothing does.
 */
describe("reading an image", () => {
  let detect;
  let constructed;
  let lastOptions;

  beforeEach(() => {
    detect = vi.fn().mockResolvedValue([]);
    constructed = 0;
    lastOptions = null;
    globalThis.BarcodeDetector = class {
      static getSupportedFormats = vi.fn().mockResolvedValue(["ean_13"]);
      constructor(options) {
        constructed += 1;
        lastOptions = options;
      }
      detect(...args) {
        return detect(...args);
      }
    };
    globalThis.createImageBitmap = vi.fn(async (source) => ({
      width: source?.width ?? 4000,
      height: source?.height ?? 3000,
      close: vi.fn(),
    }));
  });

  afterEach(() => {
    delete globalThis.BarcodeDetector;
    delete globalThis.createImageBitmap;
  });

  it("returns the first barcode the reader finds", async () => {
    detect.mockResolvedValueOnce([
      { rawValue: "9780306406157" },
      { rawValue: "9784088725093" },
    ]);
    await expect(detectFromImage(new Blob())).resolves.toBe("9780306406157");
    expect(constructed).toBe(1);
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("asks the reader only for the formats a book carries", async () => {
    detect.mockResolvedValueOnce([{ rawValue: "9780306406157" }]);
    await detectFromImage(new Blob());
    expect(lastOptions.formats).toEqual(["ean_13", "ean_8", "upc_a"]);
  });

  /*
   * A phone photo is usually far larger than the decoders like, so a
   * miss on the full-size image is retried once on a smaller copy. The
   * canvas is unavailable here, so the copy falls back to the original
   * — the point being that the second read happens at all.
   */
  it("reads a second time when the first pass finds nothing", async () => {
    await expect(detectFromImage(new Blob())).resolves.toBeNull();
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it("stops at the first pass when it succeeds", async () => {
    detect.mockResolvedValueOnce([{ rawValue: "9780306406157" }]);
    await detectFromImage(new Blob());
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("says nothing rather than throwing when the image cannot be read", async () => {
    globalThis.createImageBitmap = vi.fn().mockRejectedValue(new Error("nope"));
    await expect(detectFromImage(new Blob())).resolves.toBeNull();
  });

  it("says nothing when the reader itself blows up", async () => {
    detect.mockRejectedValue(new Error("decoder gave up"));
    await expect(detectFromImage(new Blob())).resolves.toBeNull();
  });
});

describe("scanning a video", () => {
  let detect;

  beforeEach(() => {
    vi.useFakeTimers();
    detect = vi.fn().mockResolvedValue([]);
    globalThis.BarcodeDetector = class {
      static getSupportedFormats = vi.fn().mockResolvedValue(["ean_13"]);
      detect(...args) {
        return detect(...args);
      }
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.BarcodeDetector;
  });

  const flush = async (times = 1) => {
    for (let i = 0; i < times; i++) {
      await vi.advanceTimersByTimeAsync(130);
    }
  };

  it("reports every barcode the loop decodes", async () => {
    const onDetect = vi.fn();
    detect.mockResolvedValue([{ rawValue: "9780306406157" }]);
    const stop = await startScan({ readyState: 4 }, onDetect);
    await flush(2);
    expect(onDetect).toHaveBeenCalledWith("9780306406157");
    await stop();
  });

  it("waits for the video to hold a frame before reading it", async () => {
    const onDetect = vi.fn();
    const stop = await startScan({ readyState: 0 }, onDetect);
    await flush(2);
    expect(detect).not.toHaveBeenCalled();
    await stop();
  });

  it("stops looping once stopped", async () => {
    const onDetect = vi.fn();
    const stop = await startScan({ readyState: 4 }, onDetect);
    await flush();
    const before = detect.mock.calls.length;
    await stop();
    await flush(3);
    expect(detect.mock.calls.length).toBe(before);
  });
});
