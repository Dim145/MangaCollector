import { QueryClient } from "@tanstack/react-query";

/*
 * React Query is used purely as a coordinator for background refreshes and
 * mutation lifecycle (onMutate/onError rollback). The source of truth that
 * components render from is Dexie (via useLiveQuery), so persisting the query
 * cache itself is unnecessary — the Dexie tables already give us cold-start
 * offline reads.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // When offline, React Query would normally "pause" fetches. We want
      // reads from Dexie to still happen, so we use "offlineFirst" — network
      // is attempted but failure is non-fatal and we keep cached data.
      networkMode: "offlineFirst",
      retry: (failureCount, error) => {
        // Don't retry on auth/validation errors
        const status = error?.response?.status;
        if (status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      // Dexie is the source of truth via useLiveQuery, so React Query only
      // needs to trigger background refreshes once per session window. A 5-min
      // staleTime keeps navigations between Dashboard/Profile/Settings from
      // re-hitting the server every 30s. Tab-focus still refetches (below).
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: true,
    },
    mutations: {
      networkMode: "offlineFirst",
    },
  },
});

/*
 * 始 · Session-loss listener.
 *
 * The axios 401 interceptor dispatches `mc:session-lost` on the window
 * before redirecting to /log-in. The redirect itself force-reloads the
 * SPA and gives us a clean cache, BUT only when the user is on an auth-
 * required path. On a public path (`/`, `/u/<slug>`, `/glossary`) we
 * stay put — and without this listener the React Query cache would
 * keep the now-revoked session's private data resident in memory until
 * the next mutation invalidated it.
 *
 * `clear()` drops every query atomically, including in-flight ones.
 * Components that need data will re-fetch on their next render.
 */
if (typeof window !== "undefined") {
  window.addEventListener("mc:session-lost", () => {
    try {
      queryClient.clear();
    } catch {
      /* clearing a fresh QueryClient should never throw — defensive */
    }
  });
}
