import { describe, expect, it } from "vitest";
import { deriveListState } from "./queryState.js";

/*
 * `deriveListState` encodes the four-state ladder every list hook
 * shares (useLibrary / useVolumesForManga / useAllVolumes). The flags
 * are mutually constraining — "skeleton" and "empty state" must never
 * be true at once, or the UI paints both — so the table below walks
 * the whole state space rather than spot-checking a few rows.
 */

const query = (over = {}) => ({ isPending: false, isFetching: false, ...over });

describe("deriveListState", () => {
  it("always hands back an array, never undefined", () => {
    expect(deriveListState(undefined, query()).data).toEqual([]);
    expect(deriveListState(null, query()).data).toEqual([]);
    expect(deriveListState([1, 2], query()).data).toEqual([1, 2]);
  });

  describe("cold start", () => {
    it("is an initial load while Dexie has not answered yet", () => {
      // `data === undefined` is useLiveQuery's "still resolving" signal.
      const s = deriveListState(undefined, query({ isPending: true, isFetching: true }));
      expect(s.isInitialLoad).toBe(true);
      expect(s.isEmpty).toBe(false);
      expect(s.isRefetching).toBe(false);
    });

    it("stays an initial load when Dexie answered empty and the network is still pending", () => {
      const s = deriveListState([], query({ isPending: true, isFetching: true }));
      expect(s.isInitialLoad).toBe(true);
      expect(s.isEmpty).toBe(false);
    });
  });

  describe("warm cache", () => {
    it("reports a background refetch without engaging the skeleton", () => {
      const s = deriveListState([{ id: 1 }], query({ isFetching: true }));
      expect(s.isRefetching).toBe(true);
      expect(s.isInitialLoad).toBe(false);
      expect(s.isEmpty).toBe(false);
    });

    it("is not refetching once the network settles", () => {
      const s = deriveListState([{ id: 1 }], query());
      expect(s.isRefetching).toBe(false);
      expect(s.isInitialLoad).toBe(false);
      expect(s.isEmpty).toBe(false);
    });

    it("does not call a first fetch over cached rows a refetch", () => {
      // Both pending AND fetching with rows already in Dexie: this is
      // still the initial network round-trip, so the background-refresh
      // indicator must stay off.
      const s = deriveListState([{ id: 1 }], query({ isPending: true, isFetching: true }));
      expect(s.isRefetching).toBe(false);
    });
  });

  describe("genuinely empty", () => {
    it("reports empty once the fetch resolved with nothing", () => {
      const s = deriveListState([], query());
      expect(s.isEmpty).toBe(true);
      expect(s.isInitialLoad).toBe(false);
      expect(s.isRefetching).toBe(false);
    });
  });

  describe("disabled hooks", () => {
    it("does not engage the initial load when the hook is disabled", () => {
      // `useVolumesForManga(null)` passes `enabled: false`; TanStack
      // keeps reporting `isPending` forever for a query that never
      // runs, which would otherwise pin the skeleton on screen.
      const s = deriveListState([], query({ isPending: true }), { enabled: false });
      expect(s.isInitialLoad).toBe(false);
      expect(s.isEmpty).toBe(true);
    });

    it("defaults to enabled when no option is passed", () => {
      const s = deriveListState([], query({ isPending: true }));
      expect(s.isInitialLoad).toBe(true);
    });
  });

  it("keeps isLoading as an alias of isInitialLoad in every state", () => {
    const cases = [
      [undefined, query({ isPending: true })],
      [[], query({ isPending: true })],
      [[], query()],
      [[{ id: 1 }], query({ isFetching: true })],
      [[{ id: 1 }], query()],
    ];
    for (const [data, q] of cases) {
      const s = deriveListState(data, q);
      expect(s.isLoading).toBe(s.isInitialLoad);
    }
  });

  it("never reports a skeleton and an empty state at the same time", () => {
    for (const data of [undefined, [], [{ id: 1 }]]) {
      for (const isPending of [true, false]) {
        for (const isFetching of [true, false]) {
          for (const enabled of [true, false]) {
            const s = deriveListState(data, query({ isPending, isFetching }), {
              enabled,
            });
            expect(s.isInitialLoad && s.isEmpty).toBe(false);
          }
        }
      }
    }
  });
});
