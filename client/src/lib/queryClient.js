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
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
    mutations: {
      networkMode: "offlineFirst",
    },
  },
});
