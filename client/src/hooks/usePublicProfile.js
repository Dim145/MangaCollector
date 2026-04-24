import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "@/utils/axios.js";

/**
 * Fetch the read-only public profile by slug. No auth — this calls the
 * anonymous `/api/public/u/:slug` endpoint. 404 surfaces as `isError`
 * with the axios error in `error`.
 */
export function usePublicProfile(slug) {
  const q = useQuery({
    queryKey: ["public-profile", slug],
    enabled: typeof slug === "string" && slug.length > 0,
    queryFn: async () => {
      const { data } = await axios.get(
        `/api/public/u/${encodeURIComponent(slug)}`,
      );
      return data;
    },
    // Public profiles change slowly; give TanStack a comfortable window.
    staleTime: 60_000,
    retry: (count, err) => {
      // Don't retry on 404 — it's a clear "no such profile" answer.
      if (err?.response?.status === 404) return false;
      return count < 2;
    },
  });
  return {
    data: q.data,
    isLoading: q.isPending,
    isError: q.isError,
    error: q.error,
    status: q.status,
  };
}

/**
 * The authenticated user's own public-profile state. Exposes both the
 * slug and the adult-content opt-in, plus two mutations that target the
 * dedicated backend endpoints (one per field — avoids the serde "null
 * vs absent" pitfall of trying to PATCH both with one payload).
 *
 * Both mutations share the same cache entry so the Settings UI always
 * renders a consistent pair of toggles.
 */
export function useOwnPublicSlug() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["own-public-slug"],
    queryFn: async () => {
      const { data } = await axios.get("/api/user/public-slug");
      return data;
    },
    staleTime: 30_000,
  });
  const slugMut = useMutation({
    mutationFn: async (slug) => {
      const { data } = await axios.patch("/api/user/public-slug", {
        slug: slug == null || slug === "" ? null : slug,
      });
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["own-public-slug"], data);
    },
  });
  const adultMut = useMutation({
    mutationFn: async (showAdult) => {
      const { data } = await axios.patch("/api/user/public-adult", {
        show_adult: Boolean(showAdult),
      });
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["own-public-slug"], data);
    },
  });
  return {
    slug: q.data?.slug ?? null,
    showAdult: Boolean(q.data?.show_adult),
    isLoading: q.isPending,
    update: slugMut.mutateAsync,
    isUpdating: slugMut.isPending,
    updateError: slugMut.error,
    updateShowAdult: adultMut.mutateAsync,
    isUpdatingAdult: adultMut.isPending,
  };
}
