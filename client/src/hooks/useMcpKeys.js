import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "@/utils/axios.js";

/**
 * 鍵 · The MCP API keys of the signed-in account: list, mint, revoke,
 * plus the scope catalogue the mint dialog renders and the audit trail
 * of what agents did.
 *
 * **The minted secret never enters the query cache.** `mint` is a
 * mutation and its result is returned to the caller, which holds it in
 * component state for as long as the reveal dialog is open and then
 * drops it. Putting it in the cache would keep a live credential in
 * memory for the rest of the session, surface it in devtools, and
 * survive navigation — for a value the server itself cannot show twice.
 */
export function useMcpKeys() {
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ["mcpKeys"],
    queryFn: async () => {
      const res = await axios.get("/api/user/api-keys");
      return Array.isArray(res.data) ? res.data : [];
    },
    // Small list, changes only when this page changes it.
    staleTime: 30_000,
  });

  const catalogue = useQuery({
    queryKey: ["mcpScopes"],
    queryFn: async () => {
      const res = await axios.get("/api/user/api-keys/scopes");
      return res.data ?? {};
    },
    // The vocabulary only changes when the server is redeployed, and
    // `enabled` with it — a boot-time read is the right granularity.
    staleTime: Infinity,
  });

  const mint = useMutation({
    mutationFn: async ({ label, scopes, expiresAt }) => {
      const res = await axios.post("/api/user/api-keys", {
        label,
        scopes,
        expires_at: expiresAt || null,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcpKeys"] });
    },
  });

  const revoke = useMutation({
    mutationFn: async (id) => {
      await axios.delete(`/api/user/api-keys/${encodeURIComponent(id)}`);
      return id;
    },
    onSuccess: (revokedId) => {
      // Optimistic: drop the row so the list feels instant.
      queryClient.setQueryData(["mcpKeys"], (prev) =>
        Array.isArray(prev) ? prev.filter((k) => k.id !== revokedId) : prev,
      );
      // The trail outlives the key (`api_key_id` goes NULL rather than
      // cascading), but the row's own label is gone from it — refetch so
      // the panel stops implying otherwise.
      queryClient.invalidateQueries({ queryKey: ["mcpAudit"] });
    },
    onError: () => {
      // Reconcile against the server when the DELETE fails, or the
      // optimistic removal above never happens and the list quietly
      // lies about which keys exist until staleTime elapses.
      queryClient.invalidateQueries({ queryKey: ["mcpKeys"] });
    },
  });

  return {
    keys: list.data ?? [],
    isLoading: list.isLoading,
    isError: list.isError,
    enabled: catalogue.data?.enabled ?? false,
    allScopes: catalogue.data?.all ?? [],
    readOnlyScopes: catalogue.data?.read_only ?? [],
    catalogueReady: catalogue.isSuccess,
    mint: mint.mutateAsync,
    isMinting: mint.isPending,
    revoke: revoke.mutateAsync,
    isRevoking: revoke.isPending,
  };
}

/**
 * 記 · What agents did on this account. Separate from `useMcpKeys` so
 * the panel only fetches it when the user asks to see it — it is the
 * one call here that grows without bound.
 */
export function useMcpAudit(enabled) {
  return useQuery({
    queryKey: ["mcpAudit"],
    queryFn: async () => {
      const res = await axios.get("/api/user/api-keys/audit", {
        params: { limit: 50 },
      });
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: Boolean(enabled),
    staleTime: 10_000,
  });
}
