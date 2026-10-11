import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, loadLanguage, loadNamespaces } from "@/i18n/index.jsx";
import { PAGE_NAMESPACES } from "@/i18n/split.js";

/*
 * The camera reports every frame it decodes; the scanner turns that into
 * one read per book. It used to let the first read through and then
 * nothing at all until it was unmounted — "Scan next" on /scan, filing
 * tomes into a place and stock-taking all went deaf after one barcode.
 */

let report = null;
vi.mock("@/lib/barcode.js", () => ({
  startScan: vi.fn(async (_video, onDetect) => {
    report = onDetect;
    return async () => {};
  }),
  cameraControls: () => ({ torch: false, zoom: null, setTorch: async () => true, setZoom: () => {} }),
  detectFromImage: vi.fn(),
}));

const { default: BarcodeScanner } = await import("./BarcodeScanner.jsx");
const { startScan } = await import("@/lib/barcode.js");

beforeAll(async () => {
  await loadLanguage("en");
  await loadNamespaces(PAGE_NAMESPACES.ScanPage);
});

beforeEach(() => {
  report = null;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const track = { stop: vi.fn() };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [track],
        getVideoTracks: () => [track],
      })),
    },
  });
  HTMLMediaElement.prototype.play = vi.fn(async () => {});
});

afterEach(() => {
  vi.useRealTimers();
});

async function mount(props = {}) {
  const onDetect = vi.fn();
  render(
    <I18nProvider lang="en">
      <BarcodeScanner onDetect={onDetect} onClose={() => {}} {...props} />
    </I18nProvider>,
  );
  await waitFor(() => expect(report).toBeTypeOf("function"));
  return onDetect;
}

describe("BarcodeScanner", () => {
  it("keeps reading after the first barcode", async () => {
    const onDetect = await mount();
    act(() => report("9782723488525"));
    act(() => vi.advanceTimersByTime(1500));
    act(() => report("9782723489621"));
    expect(onDetect.mock.calls.map((c) => c[0])).toEqual(["9782723488525", "9782723489621"]);
  });

  it("reads a book held in front of it once, and again only after it left the frame", async () => {
    const onDetect = await mount();
    act(() => report("9782723488525"));
    // Held still: the camera keeps decoding it every 120 ms.
    for (let i = 0; i < 30; i += 1) {
      act(() => vi.advanceTimersByTime(120));
      act(() => report("9782723488525"));
    }
    expect(onDetect).toHaveBeenCalledTimes(1);
    // Gone for a few seconds, then shown again: a second copy.
    act(() => vi.advanceTimersByTime(3200));
    act(() => report("9782723488525"));
    expect(onDetect).toHaveBeenCalledTimes(2);
  });

  it("lets the next book settle before reading it", async () => {
    const onDetect = await mount();
    act(() => report("9782723488525"));
    act(() => vi.advanceTimersByTime(300));
    act(() => report("9782723489621"));
    expect(onDetect).toHaveBeenCalledTimes(1);
  });

  it("opens the manual tray without restarting the camera", async () => {
    await mount();
    expect(startScan).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole("button", { name: /type isbn/i })[0]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(startScan).toHaveBeenCalledTimes(1);
  });
});
