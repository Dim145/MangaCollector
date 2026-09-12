import { beforeEach, describe, expect, it } from "vitest";
import { acquireScrollLock, releaseScrollLock } from "./scrollLock.js";

/*
 * The module header documents a concrete four-step leak that a shared
 * counter exists to prevent: two overlapping locks, the second one
 * snapshotting the first one's write, and the body left permanently
 * unscrollable after both close. That scenario is the centrepiece of
 * this suite.
 *
 * The counter is a module-level singleton, so each test has to unwind
 * it fully — `beforeEach` drains any residue before starting.
 */

const overflow = () => document.body.style.overflow;

beforeEach(() => {
  // Drain the shared counter left behind by a previous case, then
  // reset the body to a known clean state.
  for (let i = 0; i < 20; i++) releaseScrollLock();
  document.body.style.overflow = "";
});

describe("single lock", () => {
  it("hides overflow on acquire", () => {
    acquireScrollLock();
    expect(overflow()).toBe("hidden");
  });

  it("restores the original overflow on release", () => {
    acquireScrollLock();
    releaseScrollLock();
    expect(overflow()).toBe("");
  });

  it("restores a non-empty pre-lock value", () => {
    document.body.style.overflow = "scroll";
    acquireScrollLock();
    expect(overflow()).toBe("hidden");
    releaseScrollLock();
    expect(overflow()).toBe("scroll");
  });
});

describe("overlapping locks", () => {
  it("keeps the body locked while any holder remains", () => {
    acquireScrollLock();
    acquireScrollLock();
    releaseScrollLock();
    expect(overflow()).toBe("hidden");
    releaseScrollLock();
    expect(overflow()).toBe("");
  });

  it("does not leak a lock when holders close in the order they opened", () => {
    // The exact scenario from the module header: A locks, B mounts
    // while A is active, A unmounts, B unmounts. With per-component
    // counters B would snapshot A's "hidden" and restore it at step 4,
    // leaving the page unscrollable with nothing open.
    acquireScrollLock(); // A
    acquireScrollLock(); // B, while A holds
    releaseScrollLock(); // A unmounts first
    releaseScrollLock(); // B unmounts
    expect(overflow()).toBe("");
  });

  it("does not leak a lock when holders close in reverse order", () => {
    acquireScrollLock();
    acquireScrollLock();
    releaseScrollLock();
    releaseScrollLock();
    expect(overflow()).toBe("");
  });

  it("survives a deep stack of holders", () => {
    for (let i = 0; i < 10; i++) acquireScrollLock();
    for (let i = 0; i < 9; i++) releaseScrollLock();
    expect(overflow()).toBe("hidden");
    releaseScrollLock();
    expect(overflow()).toBe("");
  });

  it("snapshots the pre-lock value exactly once, from the first acquire", () => {
    document.body.style.overflow = "auto";
    acquireScrollLock();
    acquireScrollLock();
    releaseScrollLock();
    releaseScrollLock();
    expect(overflow()).toBe("auto");
  });
});

describe("defensive clamping", () => {
  it("clamps a release with no matching acquire", () => {
    releaseScrollLock();
    expect(overflow()).toBe("");
  });

  it("does not underflow into negative counts", () => {
    // An underflow would mean the NEXT single modal needs two releases
    // to unlock, leaving the body stuck after it closes.
    releaseScrollLock();
    releaseScrollLock();
    releaseScrollLock();
    acquireScrollLock();
    expect(overflow()).toBe("hidden");
    releaseScrollLock();
    expect(overflow()).toBe("");
  });

  it("tolerates a double release from one holder", () => {
    acquireScrollLock();
    releaseScrollLock();
    releaseScrollLock();
    acquireScrollLock();
    expect(overflow()).toBe("hidden");
    releaseScrollLock();
    expect(overflow()).toBe("");
  });
});
