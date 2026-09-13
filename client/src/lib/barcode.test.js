import { describe, expect, it, vi } from "vitest";
import { cameraControls } from "./barcode.js";

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
