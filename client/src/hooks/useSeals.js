import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import axios from "@/utils/axios.js";
import { db } from "@/lib/db.js";
import { notifySealsUnlocked } from "@/lib/sealsToast.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 印鑑帳 — carnet de sceaux, Dexie-first.
 *
 * The server evaluates the full catalog on every GET and may grant new
 * seals in the same call. The response carries two orthogonal pieces:
 *
 *   - `earned`         : the stable list of earned seals
 *                        `[{ code, earned_at }]`. This is the canonical
 *                        projection shown in the journal.
 *   - `newly_granted`  : transient — only non-empty on the exact request
 *                        that unlocked them. Drives the one-shot
 *                        ceremony animation in the UI.
 *
 * Offline strategy:
 *   • `earned` is cached in Dexie (table `seals`, single row keyed by
 *     `"user"`). The SealsPage renders directly from the cache via
 *     `useLiveQuery` — so opening the carnet offline shows every seal
 *     earned up to the last sync.
 *   • `newly_granted` is NOT persisted. Caching it would replay the
 *     ceremony every time the user opens the page after an unlock.
 *     Instead it lives in component-local state, populated on the
 *     exact fetch success that reported it.
 *
 * Sync loop:
 *   • Online: fetch → strip `newly_granted` → write stable slice to
 *     Dexie → expose newly_granted transiently.
 *   • Offline: fetch fails silently (`retry: false`), live-query keeps
 *     rendering the last cached state, `newly_granted` stays empty, no
 *     ceremony replays.
 *   • Reconnect: TanStack Query refetches on mount/focus (we leave
 *     refetchOnWindowFocus off on purpose — see below), and a fresh
 *     ceremony plays only if the server genuinely unlocked something
 *     between the last fetch and this one.
 */
export function useSeals() {
  const cached = useLiveQuery(() => db.seals.get("user"), []);
  // 言 · Always-fresh `t`. The queryFn closure below picks this up
  // for toast i18n; routing through a ref protects against the
  // narrow race where the very first /api/user/seals call (on hook
  // mount) reports a fresh unlock BEFORE settings have flipped the
  // I18nProvider to the user's preferred language — without the
  // ref, that first toast would render in EN even when the user's
  // locale is FR/ES.
  const t = useT();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Component-local transient store for the ceremony signal. Kept
  // intentionally OUTSIDE of React Query's cache so it can't survive
  // remounts — once the user has seen a ceremony, they've seen it.
  const [newlyGranted, setNewlyGranted] = useState([]);

  const query = useQuery({
    queryKey: ["seals"],
    queryFn: async () => {
      const { data } = await axios.get("/api/user/seals");
      // Strip the transient signal BEFORE persisting: `stable` is
      // cached (without newly_granted), `newly_granted` flows to
      // component-local state below to drive the one-shot ceremony.
      const { newly_granted, ...stable } = data ?? {};
      await db.seals.put({ key: "user", ...stable });
      const codes = Array.isArray(newly_granted) ? newly_granted : [];
      setNewlyGranted(codes);
      // 印 · Also fire the toast(s). When the user navigates
      // straight to /seals after triggering an unlock, useSeals'
      // fetch wins the race against the App-level
      // `SealsUnlockToaster` (which has a 600 ms debounce). Without
      // this call the toast would never fire on that fast-nav path.
      // Server atomicity guarantees `newly_granted` is non-empty
      // on AT MOST one of the two competing fetches, so calling
      // from both can't double-fire.
      notifySealsUnlocked(codes, tRef.current);
      return data;
    },
    // Short stale window — a user who just completed a milestone in
    // another tab/device should see the new seal quickly. But we don't
    // hammer the endpoint: 15s is enough to skip the re-fetch loop
    // caused by fast navigations.
    staleTime: 15_000,
    // Returning to the tab shouldn't replay the ceremony — a focus
    // change isn't a fresh milestone. The user initiates the re-fetch
    // by navigating to /seals or by an explicit refresh.
    refetchOnWindowFocus: false,
    // Offline: don't pile up retries. The live-query already handles
    // the cached read, and reconnection triggers a fresh run via the
    // sync runner's connectivity hook.
    retry: false,
  });

  // Compose the return shape: cached stable state + transient
  // ceremony signal (empty offline or on any fetch that didn't grant
  // anything). Consumers stay identical to the previous API shape.
  const data = cached
    ? {
        ...Object.fromEntries(
          Object.entries(cached).filter(([k]) => k !== "key"),
        ),
        newly_granted: newlyGranted,
      }
    : null;

  const dexieReady = cached !== undefined;
  const pending = query.isPending;

  return {
    data,
    // "Loading" now means: no cached seals yet AND a request in flight.
    // Cached data hides the spinner and lets the journal render
    // immediately — even offline.
    isLoading: !dexieReady && pending,
    isError: query.isError,
    error: query.error,
  };
}
