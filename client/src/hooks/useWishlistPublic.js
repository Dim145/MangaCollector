import { useCallback, useEffect, useState } from "react";
import axios from "@/utils/axios.js";
import {
  getAuthStatus,
  getCachedUser,
  mergeCachedUser,
} from "@/utils/auth.js";

/**
 * 祝 · Birthday-mode toggle hook.
 *
 * Reads the wishlist-public horizon from the cached `/auth/user` response
 * and exposes mutations to arm / clear it. The cached user object is the
 * single source of truth — this hook hydrates from it, then refetches
 * after every mutation so the value the UI shows always matches what the
 * server confirmed (the server clamps the duration at 365 days).
 *
 * `until` is a `Date | null`. `null` means the feature is off (or expired,
 * which the server normalises identically). When non-null, it's
 * guaranteed to be in the future at the moment it was returned.
 */
export function useWishlistPublic() {
  const [until, setUntil] = useState(() => readUntil());
  const [pending, setPending] = useState(false);

  // Hydrate on mount in case the cached user predates this feature
  // (e.g. the user logged in before the deploy and never refetched).
  // getAuthStatus is cheap, idempotent, and short-circuits offline.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const status = await getAuthStatus();
      if (cancelled) return;
      if (status.kind === "authenticated" || status.kind === "cached") {
        setUntil(parseUntil(status.user?.wishlist_public_until));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isActive = until != null && until.getTime() > Date.now();

  /** Arm the toggle for `days` days. days <= 0 clears the horizon. */
  const setDays = useCallback(async (days) => {
    setPending(true);
    try {
      const response = await axios.patch("/api/user/wishlist-public", {
        days: Number(days) || 0,
      });
      const next = parseUntil(response.data?.wishlist_public_until);
      setUntil(next);
      // Mirror into the cached user so getCachedUser() readers stay in
      // sync without an extra /auth/user round-trip.
      mergeCachedUser({
        wishlist_public_until: next ? next.toISOString() : null,
      });
      return next;
    } finally {
      setPending(false);
    }
  }, []);

  const deactivate = useCallback(() => setDays(0), [setDays]);

  return { until, isActive, pending, setDays, deactivate };
}

/** Read the cached user's `wishlist_public_until` synchronously. */
function readUntil() {
  return parseUntil(getCachedUser()?.wishlist_public_until);
}

/** Parse the server's ISO timestamp; returns null when absent or invalid. */
function parseUntil(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}
