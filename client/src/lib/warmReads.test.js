import { beforeEach, describe, expect, it } from "vitest";
import { forgetReads, lastRead, rememberRead } from "./warmReads.js";

/*
 * 温 · The shelf mounting again starts from the last answer of its reads
 * instead of a skeleton — and never from another account's.
 */

beforeEach(() => forgetReads());

describe("warm reads", () => {
  it("keep the last answer, and ignore one still loading", () => {
    rememberRead("library", [{ mal_id: 13 }]);
    rememberRead("library", undefined);
    expect(lastRead("library")).toEqual([{ mal_id: 13 }]);
  });

  it("keep an empty shelf as an answer", () => {
    rememberRead("library", []);
    expect(lastRead("library")).toEqual([]);
  });

  it("forget everything with the caches", () => {
    rememberRead("library", [{ mal_id: 13 }]);
    rememberRead("volumes", [{ id: 1 }]);
    forgetReads();
    expect(lastRead("library")).toBeUndefined();
    expect(lastRead("volumes")).toBeUndefined();
  });
});
