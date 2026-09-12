import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { emitSyncEvent } from "@/lib/sync/events.js";
import { getClientId } from "@/lib/clientId.js";
import { KIND_TO_KEYS, planRealtimeAction } from "@/lib/realtimePlan.js";
import { refetchLibraryEntry, refetchVolumes } from "@/lib/sync/outbox.js";

/**
 * 同期 · Realtime invalidation receiver.
 *
 * Opens an authenticated WebSocket to `/api/ws` and invalidates the
 * matching TanStack Query keys whenever the server pushes a sync
 * event for the current user.
 *
 * Reconnect strategy:
 *   • Exponential backoff starting at 1s, capped at 30s.
 *   • Resets to 1s on a successfully-opened connection.
 *   • Gives up entirely when the tab is hidden and resumes on focus
 *     so we don't burn CPU reconnecting behind a backgrounded tab.
 *
 * The server authenticates the socket via the same session cookie
 * the REST endpoints use, so the only requirement is that the user
 * be logged in at the moment the hook mounts. 401 on connect is
 * treated as "stop trying" — the ProtectedRoute will push the user
 * to /log-in via HTTP anyway.
 *
 * The hook intentionally returns nothing: it's a side-effect only
 * hook mounted near the root of the app. Adding a UI indicator
 * (dot pulse on activity, etc.) would be a separate concern.
 */

/** Map a server `kind` to the TanStack Query keys it invalidates. */

export function useRealtimeSync({ enabled = true } = {}) {
  const qc = useQueryClient();
  // We keep the socket + backoff in refs so effect re-runs don't
  // accidentally open duplicates. The effect is keyed only on
  // `enabled` to keep the lifetime tied to auth.
  const socketRef = useRef(null);
  const retryRef = useRef({ delay: 1000, timer: null });
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    stoppedRef.current = false;

    // Snapshot the ref's current object into a local at effect-setup
    // time so the cleanup captures the same backoff record (same
    // object, not just a `.current` read) that the connect/schedule
    // closures mutate. `retryRef.current` is only ever mutated in
    // place (`{ delay, timer }` fields assigned), never reassigned,
    // so `retry` and `retryRef.current` always point at the same
    // object — but the React Hooks lint warns on `ref.current` in
    // cleanup because it CAN'T know that in general, and this local
    // capture satisfies it without changing semantics.
    const retry = retryRef.current;

    const wsUrl = () => {
      const { protocol, host } = window.location;
      const scheme = protocol === "https:" ? "wss:" : "ws:";
      // 源 · The upgrade request can't carry custom headers from the
      // browser API, so the client id rides in the query string; the
      // server uses it to skip echoing this tab's own changes back.
      return `${scheme}//${host}/api/ws?client_id=${encodeURIComponent(getClientId())}`;
    };

    // 集 · Coalesce query invalidations over a short window. The broker
    // has no per-connection origin tag, so it bounces a client's OWN
    // mutations back to it alongside other devices' changes. Invalidating
    // immediately on each echo means a rapid burst (e.g. toggling a
    // volume read/unread) fires interleaved refetches that can briefly
    // overwrite a still-pending optimistic write — a visible flicker.
    // Batching the keys and flushing ~300 ms after the burst starts
    // collapses the storm into one refetch, by which point the server
    // reflects the settled state. The server now also stamps events
    // with the originating client id and skips this tab's own echo at
    // the socket, so the storm is mostly other devices' — and, when it
    // scopes an event to a series, we refresh just those rows below
    // instead of invalidating collection-wide keys at all.
    const myClientId = getClientId();
    const coalescedKeys = new Set();
    let invalidateTimer = null;
    const scheduleInvalidate = () => {
      if (invalidateTimer) return;
      invalidateTimer = setTimeout(() => {
        invalidateTimer = null;
        const keys = [...coalescedKeys].map((s) => JSON.parse(s));
        coalescedKeys.clear();
        for (const key of keys) {
          qc.invalidateQueries({ queryKey: key });
        }
      }, 300);
    };

    // 範 · Scoped events: one in-flight refresh per `kind:mal_id`. The
    // rows land in Dexie and every live query re-renders from there,
    // so no React Query key needs invalidating for these.
    const inFlight = new Map();
    const refreshScoped = (kind, mal_id) => {
      const token = `${kind}:${mal_id}`;
      if (inFlight.has(token)) return;
      const run = kind === "library" ? refetchLibraryEntry : refetchVolumes;
      inFlight.set(
        token,
        run(mal_id)
          .catch(() => {
            // Fall back to the broad invalidation this kind always had;
            // a transient failure must not leave the row stale forever.
            for (const key of KIND_TO_KEYS[kind]) {
              coalescedKeys.add(JSON.stringify(key));
            }
            scheduleInvalidate();
          })
          .finally(() => inFlight.delete(token)),
      );
    };

    const connect = () => {
      if (stoppedRef.current) return;
      // Clean up any stale socket before opening a fresh one.
      if (socketRef.current) {
        try {
          socketRef.current.close();
        } catch {
          /* ignore */
        }
        socketRef.current = null;
      }

      let ws;
      try {
        ws = new WebSocket(wsUrl());
      } catch (err) {
        console.warn("[realtime] ws construction failed", err);
        schedule();
        return;
      }
      socketRef.current = ws;

      ws.addEventListener("open", () => {
        retryRef.current.delay = 1000; // success resets the backoff
      });

      ws.addEventListener("message", (evt) => {
        try {
          const raw = JSON.parse(evt.data);
          // 検 · Schema gate. The socket runs over the same origin as
          // the SPA, but a same-origin XSS or a future broadening of
          // CSP could let an attacker emit messages a subscriber
          // would treat as authoritative. Validate the payload shape
          // before we either re-broadcast or invalidate query caches.
          if (!raw || typeof raw !== "object") return;
          const plan = planRealtimeAction(raw, myClientId);
          if (plan.type === "ignore") return; // malformed, unknown kind, or our own echo
          emitSyncEvent({
            kind: raw.kind,
            user_id: typeof raw.user_id === "number" ? raw.user_id : null,
            mal_id: Number.isInteger(raw.mal_id) ? raw.mal_id : null,
            payload: raw.payload,
          });
          if (plan.type === "refresh") {
            refreshScoped(plan.kind, plan.mal_id);
            return;
          }
          for (const key of plan.keys) {
            coalescedKeys.add(JSON.stringify(key));
          }
          scheduleInvalidate();
        } catch {
          /* malformed message — ignore */
        }
      });

      ws.addEventListener("close", (evt) => {
        // Identity guard: a stale socket's `close` can arrive AFTER a
        // newer socket has already been opened (e.g. a fast hide/show
        // cycle drives a visibility-triggered reconnect before the old
        // socket's async close fires). Without this, the late close
        // would `schedule()` a second reconnect on top of the live
        // socket — a duplicate-connection storm. Only the current
        // socket's close is allowed to drive the reconnect.
        if (socketRef.current !== ws) return;
        socketRef.current = null;
        // Codes that should NOT trigger a reconnect:
        //   1000 — normal close (intentional, e.g. unmount)
        //   1008 — policy violation (auth / origin)
        //   1011 — server error (the upstream is unhealthy; let it
        //          recover and the next visibility change reconnects)
        if (evt.code === 1000 || evt.code === 1008 || evt.code === 1011) return;
        if (stoppedRef.current) return;
        schedule();
      });

      ws.addEventListener("error", () => {
        // `error` fires before `close` on network hiccups; let the
        // close handler drive the reconnect to avoid double-scheduling.
      });
    };

    const schedule = () => {
      if (stoppedRef.current) return;
      if (retryRef.current.timer) return;
      const delay = retryRef.current.delay;
      retryRef.current.timer = setTimeout(() => {
        retryRef.current.timer = null;
        retryRef.current.delay = Math.min(delay * 2, 30_000);
        connect();
      }, delay);
    };

    // Pause the socket when the tab is hidden — when it comes back
    // TanStack Query's `refetchOnWindowFocus` will already refetch,
    // and we reopen to catch subsequent events.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stoppedRef.current = true;
        if (socketRef.current) {
          try {
            socketRef.current.close(1000);
          } catch {
            /* ignore */
          }
          socketRef.current = null;
        }
        if (retryRef.current.timer) {
          clearTimeout(retryRef.current.timer);
          retryRef.current.timer = null;
        }
      } else {
        stoppedRef.current = false;
        retryRef.current.delay = 1000;
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    connect();

    return () => {
      stoppedRef.current = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (invalidateTimer) {
        clearTimeout(invalidateTimer);
        invalidateTimer = null;
      }
      if (retry.timer) {
        clearTimeout(retry.timer);
        retry.timer = null;
      }
      if (socketRef.current) {
        try {
          socketRef.current.close(1000);
        } catch {
          /* ignore */
        }
        socketRef.current = null;
      }
    };
  }, [enabled, qc]);
}
