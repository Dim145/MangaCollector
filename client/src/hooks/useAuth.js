import { useQuery } from "@tanstack/react-query";
import { getAuthStatus } from "@/utils/auth.js";

/**
 * Single source of truth for "who is the logged-in user" across the
 * whole tree.
 *
 * Before this hook existed, `Header`, `ProfileButton`, `ProtectedRoute`
 * and `App.prefetchCoreUserData` all called `checkAuthStatus()` /
 * `getAuthStatus()` directly on mount — `Header` additionally
 * re-called it on every route change. First page load produced 3-4
 * parallel `/auth/user` requests; each in-app navigation produced
 * another one. In React StrictMode dev the effects ran twice,
 * doubling everything again.
 *
 * Wrapping the same call in TanStack Query gives every consumer the
 * same cache entry keyed by `["auth", "user"]`. One network request
 * per page load (and per `staleTime` window on route changes), no
 * matter how many consumers mount.
 *
 * Internally the hook keeps the three-state discriminated result
 * (`authenticated` / `cached` / `unauthenticated` / `unknown`) on
 * hand for callers that need to distinguish server-down from
 * genuinely-logged-out — ProtectedRoute uses this to decide between
 * "keep rendering with cached profile" vs "redirect to /log-in".
 * Simpler callers only look at `user` / `isAuthenticated`.
 */
export function useAuth() {
  const { data: status, isLoading } = useQuery({
    queryKey: ["auth", "user"],
    queryFn: getAuthStatus,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    // The cached-user fallback inside `getAuthStatus` already covers
    // "server unreachable → keep the UI logged in". Don't retry: the
    // underlying call already distinguishes 401 from network failure,
    // and retrying would only double-pulse the server when it comes
    // back.
    retry: false,
    // Re-validate when the user comes back to the tab — they might
    // have been logged out in another window.
    refetchOnWindowFocus: true,
  });

  const user =
    status?.kind === "authenticated" || status?.kind === "cached"
      ? status.user
      : null;

  return {
    /** Discriminated state for nuanced callers (ProtectedRoute). */
    status: status ?? { kind: "checking" },
    /** The user object or `null`. */
    user,
    /**
     * `true` if we have *any* reason to believe the user is logged in
     * (server said yes OR cache survived a network blip). `false`
     * only for the explicit 401 / logout case.
     */
    isAuthenticated: Boolean(user),
    /** First-ever call without any cache hit — useful for a spinner. */
    isLoading,
  };
}
