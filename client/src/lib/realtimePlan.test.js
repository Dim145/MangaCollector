import { describe, expect, it } from "vitest";
import { KIND_TO_KEYS, planRealtimeAction } from "./realtimePlan.js";

const ME = "tab-aaaaaaaa";
const OTHER = "tab-bbbbbbbb";

describe("planRealtimeAction", () => {
  describe("ignoring", () => {
    it.each([[null], [undefined], ["string"], [42], [[]]])(
      "ignores the non-object frame %p",
      (raw) => {
        expect(planRealtimeAction(raw, ME)).toEqual({ type: "ignore" });
      },
    );

    it.each([
      [{}],
      [{ kind: 42 }],
      [{ kind: "unknown" }],
      [{ kind: "__proto__" }],
    ])("ignores the unknown or missing kind in %j", (raw) => {
      expect(planRealtimeAction(raw, ME)).toEqual({ type: "ignore" });
    });

    it("ignores this tab's own echo", () => {
      expect(
        planRealtimeAction({ kind: "volumes", mal_id: 2, origin: ME }, ME),
      ).toEqual({
        type: "ignore",
      });
    });

    it("does not ignore another tab's event, even for the same account", () => {
      expect(
        planRealtimeAction({ kind: "volumes", mal_id: 2, origin: OTHER }, ME)
          .type,
      ).toBe("refresh");
    });

    it("does not treat a missing origin as ours", () => {
      expect(planRealtimeAction({ kind: "volumes", mal_id: 2 }, ME).type).toBe(
        "refresh",
      );
    });

    it("does not treat a missing client id as matching a missing origin", () => {
      // `undefined === undefined` must not read as "own echo".
      expect(planRealtimeAction({ kind: "library" }, undefined).type).toBe(
        "invalidate",
      );
      expect(
        planRealtimeAction({ kind: "library", origin: null }, null).type,
      ).toBe("invalidate");
    });
  });

  describe("scoped refresh", () => {
    it.each(["library", "volumes"])(
      "refreshes one series for a scoped %s event",
      (kind) => {
        expect(planRealtimeAction({ kind, mal_id: 42 }, ME)).toEqual({
          type: "refresh",
          kind,
          mal_id: 42,
        });
      },
    );

    it("accepts a negative custom-series id", () => {
      expect(
        planRealtimeAction({ kind: "library", mal_id: -3 }, ME),
      ).toMatchObject({
        type: "refresh",
        mal_id: -3,
      });
    });

    it.each([["2"], [2.5], [NaN], [null], [{}]])(
      "falls back to invalidation for the non-integer scope %p",
      (mal_id) => {
        expect(planRealtimeAction({ kind: "volumes", mal_id }, ME).type).toBe(
          "invalidate",
        );
      },
    );

    it("does not scope kinds that have no per-series refresh path", () => {
      expect(planRealtimeAction({ kind: "coffrets", mal_id: 2 }, ME)).toEqual({
        type: "invalidate",
        keys: KIND_TO_KEYS.coffrets,
      });
    });
  });

  describe("unscoped invalidation", () => {
    it.each(Object.keys(KIND_TO_KEYS))("maps %s to its query keys", (kind) => {
      expect(planRealtimeAction({ kind }, ME)).toEqual({
        type: "invalidate",
        keys: KIND_TO_KEYS[kind],
      });
    });

    it("keeps the historical volumes fan-out (all + per-series prefix)", () => {
      expect(planRealtimeAction({ kind: "volumes" }, ME).keys).toEqual([
        ["volumes-all"],
        ["volumes"],
        ["locations"],
      ]);
    });
  });

  /*
   * The table below is the contract with the server: every kind it can
   * publish, and the query keys that kind invalidates. Asserting a
   * couple of rows leaves the rest free to drift — so it is written out
   * in full, here, and compared wholesale.
   */
  it("maps every kind the server can publish to its query keys", () => {
    expect(KIND_TO_KEYS).toEqual({
      library: [["library"]],
      volumes: [["volumes-all"], ["volumes"], ["locations"]],
      coffrets: [["coffrets"], ["volumes-all"]],
      settings: [["settings"], ["user-profile"]],
      seals: [["seals"]],
      activity: [["activity"]],
      authors: [["author"]],
      snapshots: [["snapshots"]],
      friends: [["friends"]],
    });
    for (const kind of Object.keys(KIND_TO_KEYS)) {
      const plan = planRealtimeAction({ kind }, ME);
      expect(plan.keys ?? []).toEqual(KIND_TO_KEYS[kind]);
    }
  });

  it("takes a frame only from a plain object", () => {
    // a function carrying a valid `kind` is still not a frame
    const impostor = () => {};
    impostor.kind = "volumes";
    expect(planRealtimeAction(impostor, ME)).toEqual({ type: "ignore" });
  });

  it("refuses a kind that merely stringifies to a known one", () => {
    const kind = { toString: () => "volumes" };
    expect(planRealtimeAction({ kind }, ME)).toEqual({ type: "ignore" });
  });

  it("acts on a frame with no origin even when this tab has no id", () => {
    expect(planRealtimeAction({ kind: "seals" }, undefined)).toEqual({
      type: "invalidate",
      keys: [["seals"]],
    });
    expect(
      planRealtimeAction({ kind: "seals", origin: undefined }, undefined),
    ).toEqual({
      type: "invalidate",
      keys: [["seals"]],
    });
  });

  it("exposes a frozen key table so a consumer cannot mutate the contract", () => {
    expect(Object.isFrozen(KIND_TO_KEYS)).toBe(true);
  });
});
