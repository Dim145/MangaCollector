import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

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
const KIND_TO_KEYS = {
  library: [["library"]],
  volumes: [["volumes-all"], ["volumes"]],
  coffrets: [["coffrets"], ["volumes-all"]], // coffret touches volumes too
  settings: [["settings"], ["user-profile"]],
  seals: [["seals"]],
  activity: [["activity"]],
};

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

    const wsUrl = () => {
      const { protocol, host } = window.location;
      const scheme = protocol === "https:" ? "wss:" : "ws:";
      return `${scheme}//${host}/api/ws`;
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
          const event = JSON.parse(evt.data);
          const keys = KIND_TO_KEYS[event?.kind];
          if (!keys) return;
          for (const key of keys) {
            qc.invalidateQueries({ queryKey: key });
          }
        } catch {
          /* malformed message — ignore */
        }
      });

      ws.addEventListener("close", (evt) => {
        socketRef.current = null;
        // 1000 (normal) is usually an intentional close on unmount;
        // 1008/1011 shouldn't retry either (auth / protocol issues).
        if (evt.code === 1000 || evt.code === 1008) return;
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
      if (retryRef.current.timer) {
        clearTimeout(retryRef.current.timer);
        retryRef.current.timer = null;
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
