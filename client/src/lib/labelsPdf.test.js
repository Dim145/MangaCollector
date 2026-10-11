import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * 札 · The label sheet goes to a worker when the browser can paint there,
 * and comes back to the page whenever the worker cannot — a worker must
 * never be the reason a sheet does not print.
 */
const built = vi.fn(async () => new Blob(["%PDF"], { type: "application/pdf" }));
vi.mock("./labels.js", () => ({ buildLabelPdf: (...args) => built(...args) }));

const { buildLabelPdfOffThread } = await import("./labelsPdf.js");

const labels = [{ title: "One Piece", line2: "T.1" }];

class FakeWorker {
  static script = [];
  constructor(url, options) {
    this.url = String(url);
    this.options = options;
    this.terminated = false;
    FakeWorker.last = this;
  }
  postMessage(message) {
    this.sent = message;
    queueMicrotask(() => {
      for (const reply of FakeWorker.script) this.onmessage?.({ data: reply });
    });
  }
  terminate() {
    this.terminated = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  built.mockClear();
});

describe("buildLabelPdfOffThread", () => {
  it("builds on the page where there is no OffscreenCanvas", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("OffscreenCanvas", undefined);
    const progress = vi.fn();
    await buildLabelPdfOffThread(labels, { startAt: 2, onProgress: progress });
    expect(built).toHaveBeenCalledWith(labels, { startAt: 2, onProgress: progress });
  });

  it("hands the sheet to a module worker, relays its progress, returns its PDF", async () => {
    const pdf = new Blob(["%PDF-worker"], { type: "application/pdf" });
    FakeWorker.script = [{ progress: [1, 2] }, { progress: [2, 2] }, { blob: pdf }];
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("OffscreenCanvas", class {});
    const progress = vi.fn();
    const blob = await buildLabelPdfOffThread(labels, { template: "avery-l7160", onProgress: progress });
    expect(blob).toBe(pdf);
    expect(FakeWorker.last.options).toEqual({ type: "module" });
    expect(FakeWorker.last.url).toContain("labels.worker");
    // A function cannot cross into a worker: only the plain options go.
    expect(FakeWorker.last.sent).toEqual({ labels, opts: { template: "avery-l7160" } });
    expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
    expect(FakeWorker.last.terminated).toBe(true);
    expect(built).not.toHaveBeenCalled();
  });

  it("falls back to the page when the worker reports an error", async () => {
    FakeWorker.script = [{ error: "window is not defined" }];
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("OffscreenCanvas", class {});
    const blob = await buildLabelPdfOffThread(labels, {});
    expect(built).toHaveBeenCalledTimes(1);
    expect(blob.type).toBe("application/pdf");
    expect(FakeWorker.last.terminated).toBe(true);
  });

  it("falls back to the page when the worker cannot even start", async () => {
    vi.stubGlobal("Worker", class {
      constructor() {
        throw new Error("blocked by CSP");
      }
    });
    vi.stubGlobal("OffscreenCanvas", class {});
    await buildLabelPdfOffThread(labels, {});
    expect(built).toHaveBeenCalledTimes(1);
  });
});
