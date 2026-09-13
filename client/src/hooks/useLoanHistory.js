import { useQuery } from "@tanstack/react-query";
import axios from "@/utils/axios.js";

/**
 * 預け · The loan ledger — every loan ever made, newest first. Online
 * only (the past is not edited offline); cached a minute.
 */
export function useLoanHistory({ malId, limit = 300 } = {}) {
  return useQuery({
    queryKey: ["loans", "history", malId ?? "all", limit],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const params = { limit };
      if (malId != null) params.mal_id = malId;
      const { data } = await axios.get("/api/user/volume/loans/history", {
        params,
      });
      return Array.isArray(data) ? data : [];
    },
    retry: (failureCount, err) => {
      const status = err?.response?.status;
      if (status === 401 || status === 404) return false;
      return failureCount < 2;
    },
  });
}
