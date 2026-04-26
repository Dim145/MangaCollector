import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "@/utils/axios.js";

/**
 * 機 · Active session list + revocation hook.
 *
 * Reads `/api/user/sessions` (server returns one row per device with
 * `is_current` flagged). Revoking the current session is allowed —
 * the SPA treats it as a fast logout. Revoking any other session
 * invalidates that device's cookie at the next request.
 */
export function useSessions() {
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const res = await axios.get("/api/user/sessions");
      return res.data?.sessions ?? [];
    },
    // Sessions list is small and changes infrequently — generous
    // staleTime so we don't over-fetch when the modal closes/opens.
    staleTime: 30_000,
  });

  const revoke = useMutation({
    mutationFn: async (sessionId) => {
      await axios.delete(`/api/user/sessions/${encodeURIComponent(sessionId)}`);
      return sessionId;
    },
    onSuccess: (revokedId) => {
      // Optimistic cache update: drop the row from the list
      // immediately so the modal feels instant; the next refetch
      // will reconcile against the server.
      queryClient.setQueryData(["sessions"], (prev) =>
        Array.isArray(prev) ? prev.filter((s) => s.id !== revokedId) : prev,
      );
    },
  });

  return {
    sessions: list.data ?? [],
    isLoading: list.isLoading,
    isError: list.isError,
    refetch: list.refetch,
    revoke: revoke.mutateAsync,
    isRevoking: revoke.isPending,
  };
}
