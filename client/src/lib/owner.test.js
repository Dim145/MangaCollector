import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOwner,
  isForeignOwner,
  readOwner,
  writeOwner,
} from "./owner.js";

/*
 * 主 · The device's owner stamp decides whether the local caches — and
 * the offline outbox above all — belong to whoever just signed in. The
 * two answers that matter are asymmetric on purpose:
 *
 *   stamped for someone else  → wipe. Somebody else's shelf, and a
 *                               queue that would otherwise flush into
 *                               this account's library.
 *   not stamped at all        → adopt. A first run, or an install that
 *                               predates the stamp, whose queue is
 *                               legitimately this user's; wiping there
 *                               would throw away real offline work.
 *
 * Getting those two backwards is the whole risk, so they are pinned
 * separately rather than through one "does it match" assertion.
 */

beforeEach(() => {
  localStorage.clear();
});

describe("the stamp itself", () => {
  it("round-trips an id as a string", () => {
    writeOwner(7);
    expect(readOwner()).toBe("7");
  });

  it("is absent before anyone claims the device", () => {
    expect(readOwner()).toBeNull();
  });

  it("ignores a null id rather than stamping the device as nobody", () => {
    writeOwner(42);
    writeOwner(null);
    writeOwner(undefined);
    expect(readOwner()).toBe("42");
  });

  it("is forgotten on demand", () => {
    writeOwner(7);
    clearOwner();
    expect(readOwner()).toBeNull();
  });

  it("survives a storage that throws — Safari private mode", () => {
    const boom = () => {
      throw new DOMException("QuotaExceededError");
    };
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    expect(() => writeOwner(7)).not.toThrow();
    expect(readOwner()).toBeNull();
    set.mockRestore();
    get.mockRestore();
  });
});

describe("isForeignOwner", () => {
  it("says yes when the device was filled for another account", () => {
    writeOwner(7);
    expect(isForeignOwner(8)).toBe(true);
  });

  it("says no for the account that filled it", () => {
    writeOwner(7);
    expect(isForeignOwner(7)).toBe(false);
    // The id arrives as a number from the API and as a string from
    // storage; the comparison must not care which.
    expect(isForeignOwner("7")).toBe(false);
  });

  it("says no on an unstamped device — adopt, never wipe", () => {
    expect(isForeignOwner(7)).toBe(false);
  });

  it("says no when there is no id to compare against", () => {
    writeOwner(7);
    expect(isForeignOwner(null)).toBe(false);
    expect(isForeignOwner(undefined)).toBe(false);
  });
});
