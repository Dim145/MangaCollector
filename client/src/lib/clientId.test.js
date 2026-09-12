import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetClientIdForTests, getClientId } from "./clientId.js";

const SHAPE = /^[A-Za-z0-9_-]{8,64}$/;

beforeEach(() => {
  _resetClientIdForTests();
});

describe("getClientId", () => {
  it("produces an id the server will accept", () => {
    expect(getClientId()).toMatch(SHAPE);
  });

  it("is stable across calls within a tab", () => {
    expect(getClientId()).toBe(getClientId());
  });

  it("persists in sessionStorage, not localStorage", () => {
    const id = getClientId();
    expect(sessionStorage.getItem("mc:client-id")).toBe(id);
    expect(localStorage.getItem("mc:client-id")).toBeNull();
  });

  it("re-reads the stored id after the memo is dropped", () => {
    const id = getClientId();
    _resetClientIdForTests();
    expect(getClientId()).toBe(id);
  });

  it("discards a tampered stored value and mints a fresh one", () => {
    sessionStorage.setItem("mc:client-id", "<script>");
    const id = getClientId();
    expect(id).toMatch(SHAPE);
    expect(id).not.toBe("<script>");
  });

  it("still works when sessionStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const id = getClientId();
    expect(id).toMatch(SHAPE);
    expect(getClientId()).toBe(id); // memoised in-process
  });

  it("falls back to a base36 id when crypto.randomUUID is missing", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    });
    try {
      expect(getClientId()).toMatch(SHAPE);
    } finally {
      Object.defineProperty(crypto, "randomUUID", {
        value: original,
        configurable: true,
      });
    }
  });
});
