import { afterEach, describe, expect, it, vi } from "vitest";
import { announce } from "./announce.js";

describe("announce", () => {
  afterEach(() => {
    delete document.ariaNotify;
    vi.useRealTimers();
  });

  it("hands the message to ariaNotify when the browser has it", () => {
    document.ariaNotify = vi.fn();
    announce("Volume 12 owned");
    expect(document.ariaNotify).toHaveBeenCalledWith("Volume 12 owned", { priority: "normal" });
    expect(document.querySelector("[data-announcer]")).toBeNull();
  });

  it("falls back to one polite live region, read again for a repeated message", () => {
    vi.useFakeTimers();
    announce("Volume 12 owned");
    const region = document.querySelector("[data-announcer]");
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    vi.advanceTimersByTime(100);
    expect(region.textContent).toBe("Volume 12 owned");
    announce("Volume 12 owned");
    expect(region.textContent).toBe("");
    vi.advanceTimersByTime(100);
    expect(region.textContent).toBe("Volume 12 owned");
    expect(document.querySelectorAll("[data-announcer]")).toHaveLength(1);
  });

  it("says nothing for an empty message", () => {
    document.ariaNotify = vi.fn();
    announce("");
    expect(document.ariaNotify).not.toHaveBeenCalled();
  });
});
