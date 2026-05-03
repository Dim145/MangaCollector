import { useEffect, useRef } from "react";
import axios from "@/utils/axios.js";
import { db } from "@/lib/db.js";
import { onSyncEvent } from "@/lib/sync.js";
import { notifySealsUnlocked } from "@/lib/sealsToast.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 印鑑 · Seal-unlock notifier.
 *
 * Mounted near the App root alongside `<SyncToaster>`. Listens to
 * the realtime sync channel for kinds that could trigger seal
 * evaluation (library / volumes / coffrets / seals itself), then
 * fetches `/api/user/seals` once. The server's `evaluate_and_grant`
 * INSERTs any newly-qualifying seals atomically and returns the
 * codes in the `newly_granted` field of the response — those are
 * the ones we toast.
 *
 * Why it lives here rather than inside `useSeals`:
 *   `useSeals` only mounts when the SealsPage is open. A user
 *   crossing a milestone elsewhere (Dashboard, MangaPage, etc.)
 *   would never see the unlock notification — they'd only
 *   discover the new seal next time they happen to open /seals.
 *   The dedicated toaster mount runs across every page so the
 *   ceremony fires the moment the milestone is crossed.
 *
 * Throttling: a brief 600 ms coalescing window prevents a burst
 * of mutations from triggering parallel `/api/user/seals` calls.
 * Within the window we only fire one fetch; subsequent kinds in
 * the same burst get folded in.
 *
 * Mirrors the cache-aside discipline of `useSeals`: strips
 * `newly_granted` before persisting to Dexie so a hard reload
 * doesn't replay the toast.
 */
export default function SealsUnlockToaster() {
  const t = useT();
  // 言 · Always-fresh `t` reference. The subscription effect below
  // mounts ONCE (empty deps) and would otherwise close over the
  // very-first-render `t` — which is the EN fallback, because the
  // user's preferred language hasn't been resolved from /api/settings
  // yet at App boot. Routing toasts through this ref means the
  // helper always sees the current locale's translator without
  // having to tear down + re-attach the sync-event listener every
  // time the language flips.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  // Coalesce window — the ref holds the active timer id (or null).
  const timerRef = useRef(null);
  // Track the in-flight fetch so we don't kick off a parallel one
  // when a second relevant kind arrives mid-request.
  const inFlightRef = useRef(false);

  useEffect(() => {
    // 鍵 · Kinds that could move a seal threshold. We DO listen to
    // `seals` itself — the server might publish it directly when
    // some future server-side flow grants seals out of band.
    const TRIGGER_KINDS = new Set([
      "library",
      "volumes",
      "coffrets",
      "seals",
    ]);

    async function fetchAndToast() {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const { data } = await axios.get("/api/user/seals");
        // Strip the transient signal before persisting (mirror of
        // the discipline used in `useSeals`). Without this the
        // ceremony would replay every cold reload until the next
        // genuine grant.
        const stable = { ...(data ?? {}) };
        delete stable.newly_granted;
        await db.seals.put({ key: "user", ...stable });
        const codes = Array.isArray(data?.newly_granted)
          ? data.newly_granted
          : [];
        notifySealsUnlocked(codes, tRef.current);
      } catch (err) {
        // Silent — a transient network blip shouldn't surface as
        // an error toast (we'd be saying "couldn't check for
        // seals" which doesn't add value to the user). Log only.
        if (typeof console !== "undefined") {
          console.warn("[seals] unlock check failed:", err?.message);
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    function scheduleCheck() {
      if (timerRef.current) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // Fire-and-forget — internal try/catch logs failures, and
        // the next sync push will retry. No useful return value.
        void fetchAndToast();
      }, 600);
    }

    const offEvent = onSyncEvent((evt) => {
      const kind = evt.detail?.kind;
      if (!kind || !TRIGGER_KINDS.has(kind)) return;
      scheduleCheck();
    });

    return () => {
      offEvent();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return null;
}
