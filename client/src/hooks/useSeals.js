import { useQuery } from "@tanstack/react-query";
import axios from "@/utils/axios.js";

/**
 * Fetch the carnet de sceaux. The server evaluates the catalog on every
 * GET and grants any newly-qualifying seals in the same call, so the
 * response includes `newly_granted` — a list of codes that were unlocked
 * *this request* and should play a ceremonial animation on first sight.
 *
 * staleTime is short (15s) so a user who just completed a milestone in
 * another tab can see the new sceau quickly, but we don't hammer the
 * endpoint during a single page visit.
 */
export function useSeals() {
  const query = useQuery({
    queryKey: ["seals"],
    queryFn: async () => {
      const { data } = await axios.get("/api/user/seals");
      return data;
    },
    staleTime: 15_000,
    // We keep refetchOnWindowFocus off by default — returning to the tab
    // shouldn't re-fire the ceremony.
    refetchOnWindowFocus: false,
  });

  return {
    data: query.data,
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
  };
}
