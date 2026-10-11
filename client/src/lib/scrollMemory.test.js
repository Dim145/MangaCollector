import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetScrollMemory,
  announceRestore,
  canHold,
  endRestore,
  noteRestoreLaidOut,
  readScroll,
  remembersScroll,
  restoreLaidOut,
  restoringTo,
  writeScroll,
} from "./scrollMemory.js";

/*
 * 記 · One position per history entry — the property the old single-key
 * memory lacked, and the reason three round trips deep the library came
 * back to the wrong place.
 */

beforeEach(() => {
  _resetScrollMemory();
  sessionStorage.clear();
});

describe("scroll memory", () => {
  it("keeps one position per entry, not one for the page", () => {
    writeScroll("k1", 3000);
    writeScroll("k2", 500);
    expect(readScroll("k1")).toBe(3000);
    expect(readScroll("k2")).toBe(500);
    expect(readScroll("k3")).toBeNull();
  });

  it("survives a reload through sessionStorage", () => {
    writeScroll("k1", 1234.6);
    _resetScrollMemory(); // the in-memory map is gone, as after a reload
    expect(readScroll("k1")).toBe(1235);
  });

  it("stores whole non-negative pixels and nothing for a bad key", () => {
    writeScroll("k1", -40);
    expect(readScroll("k1")).toBe(0);
    writeScroll("k2", "abc");
    expect(readScroll("k2")).toBe(0);
    writeScroll(undefined, 10);
    expect(readScroll(undefined)).toBeNull();
    sessionStorage.setItem("mc:scroll:junk", "not a number");
    expect(readScroll("junk")).toBeNull();
  });

  it("forgets the oldest entries once a session has pushed a great many", () => {
    for (let i = 0; i < 205; i += 1) writeScroll(`k${i}`, i);
    expect(readScroll("k0")).toBeNull();
    expect(readScroll("k4")).toBeNull();
    expect(readScroll("k5")).toBe(5);
    expect(readScroll("k204")).toBe(204);
  });
});

describe("canHold", () => {
  it("is true only when the document can actually be scrolled that far", () => {
    // 8000px tall, 900px viewport → the furthest scroll is 7100.
    expect(canHold(8000, 900, 3366)).toBe(true);
    expect(canHold(8000, 900, 7100)).toBe(true);
    expect(canHold(8000, 900, 7101)).toBe(false);
    // A skeleton shorter than the viewport holds nothing but the top.
    expect(canHold(600, 900, 0)).toBe(true);
    expect(canHold(600, 900, 1)).toBe(false);
  });
});

describe("remembersScroll", () => {
  it("keeps the library's position and nobody else's", () => {
    expect(remembersScroll("/dashboard")).toBe(true);
    for (const other of ["/mangapage", "/backlog", "/calendrier", "/", "/settings"]) {
      expect(remembersScroll(other)).toBe(false);
    }
  });
});

describe("the restore under way", () => {
  // The app shell announces where a "back" is taking the page, so the
  // windowed grid lays out those rows in its first render.
  it("is announced for one entry and ended by that entry only", () => {
    announceRestore("lib-1", 7208);
    expect(restoringTo()).toBe(7208);
    endRestore("series-9");
    expect(restoringTo()).toBe(7208);
    endRestore("lib-1");
    expect(restoringTo()).toBeNull();
  });

  it("is nothing for an arrival that restores nothing", () => {
    announceRestore("lib-1", 7208);
    announceRestore("series-9", null);
    expect(restoringTo()).toBeNull();
    announceRestore("lib-2", Number.NaN);
    expect(restoringTo()).toBeNull();
  });
});

describe("a grid laid out for the restore", () => {
  it("is remembered through the shell's second, unchanged announcement", () => {
    announceRestore("lib-1", 7208);
    noteRestoreLaidOut();
    announceRestore("lib-1", 7208);
    expect(restoreLaidOut()).toBe(true);
    announceRestore("lib-2", 900);
    expect(restoreLaidOut()).toBe(false);
  });

  it("means nothing when no restore is under way", () => {
    noteRestoreLaidOut();
    expect(restoreLaidOut()).toBe(false);
  });
});

