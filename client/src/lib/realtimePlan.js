/*
 * 計 · Decide what a realtime `SyncEvent` should do on this client.
 *
 * Pure: takes the parsed frame plus this tab's client id, returns a
 * plan the hook executes. Kept out of `useRealtimeSync` so the whole
 * decision table is unit-testable without a socket.
 *
 * Three outcomes:
 *   { type: "ignore" }                   — malformed, unknown kind, or
 *                                          our own echo (belt-and-braces;
 *                                          the server already skips it)
 *   { type: "refresh", kind, mal_id }    — the server scoped the event
 *                                          to one series: refresh just
 *                                          those rows into Dexie. Every
 *                                          consumer reads Dexie through
 *                                          live queries, so this updates
 *                                          the UI without refetching the
 *                                          whole collection.
 *   { type: "invalidate", keys }         — unscoped: fall back to React
 *                                          Query key invalidation, the
 *                                          behaviour every event had
 *                                          before the server carried a
 *                                          scope.
 */

export const KIND_TO_KEYS = Object.freeze({
  library: [["library"]],
  // 棚 · a rename/delete of a place moves tomes; the registry rides along
  volumes: [["volumes-all"], ["volumes"], ["locations"]],
  coffrets: [["coffrets"], ["volumes-all"]], // a coffret touches volumes too
  settings: [["settings"], ["user-profile"]],
  seals: [["seals"]],
  activity: [["activity"]],
  // 作家 · Author CRUD — `["author"]` is a prefix; React Query matches
  // every `["author", malId]` detail query under it.
  authors: [["author"]],
  // 印影 · Snapshot CRUD.
  snapshots: [["snapshots"]],
  // 友 · Follow graph — `["friends"]` prefix covers list / feed / check.
  friends: [["friends"]],
});

/** Kinds whose rows can be refreshed one series at a time. */
const SCOPED_KINDS = new Set(["library", "volumes"]);

export function planRealtimeAction(raw, myClientId) {
  if (!raw || typeof raw !== "object") return { type: "ignore" };
  const { kind } = raw;
  // `Object.hasOwn`, not a truthy lookup: `KIND_TO_KEYS["__proto__"]`
  // would otherwise resolve through the prototype chain and let a
  // malformed frame past the allowlist.
  if (typeof kind !== "string" || !Object.hasOwn(KIND_TO_KEYS, kind)) {
    return { type: "ignore" };
  }
  if (
    typeof raw.origin === "string" &&
    typeof myClientId === "string" &&
    raw.origin === myClientId
  ) {
    return { type: "ignore" };
  }
  const mal_id = raw.mal_id;
  if (SCOPED_KINDS.has(kind) && Number.isInteger(mal_id)) {
    return { type: "refresh", kind, mal_id };
  }
  return { type: "invalidate", keys: KIND_TO_KEYS[kind] };
}
