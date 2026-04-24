import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "@/utils/axios.js";

/**
 * 外部輸入 · Hook to fetch a library from an external service and
 * preview it. Returns one mutation per service; each resolves with
 * `{ bundle, preview }` — the client stores the bundle and, when
 * the user confirms, re-posts it via the existing archive import.
 *
 * The commit step is shared (it's just `POST /api/user/import` with
 * the bundle we already hold), so we expose a `commit` mutation too
 * to keep all the flow state in one hook.
 */
export function useExternalImport() {
  const qc = useQueryClient();

  const mal = useMutation({
    mutationFn: async (username) => {
      const { data } = await axios.post(
        "/api/user/import/external/mal",
        { username },
      );
      return data;
    },
  });
  const anilist = useMutation({
    mutationFn: async (username) => {
      const { data } = await axios.post(
        "/api/user/import/external/anilist",
        { username },
      );
      return data;
    },
  });
  const mangadex = useMutation({
    mutationFn: async (input) => {
      const { data } = await axios.post(
        "/api/user/import/external/mangadex",
        { input },
      );
      return data;
    },
  });
  const yamtrack = useMutation({
    mutationFn: async (csv) => {
      const { data } = await axios.post(
        "/api/user/import/external/yamtrack",
        { csv },
      );
      return data;
    },
  });
  const commit = useMutation({
    mutationFn: async (bundle) => {
      const { data } = await axios.post("/api/user/import", {
        dry_run: false,
        bundle,
      });
      qc.invalidateQueries({ queryKey: ["library"] });
      qc.invalidateQueries({ queryKey: ["volumes-all"] });
      return data;
    },
  });

  return {
    fetchMal: mal.mutateAsync,
    fetchAniList: anilist.mutateAsync,
    fetchMangaDex: mangadex.mutateAsync,
    fetchYamtrack: yamtrack.mutateAsync,
    commit: commit.mutateAsync,
    isFetchingMal: mal.isPending,
    isFetchingAniList: anilist.isPending,
    isFetchingMangaDex: mangadex.isPending,
    isFetchingYamtrack: yamtrack.isPending,
    isCommitting: commit.isPending,
    malError: mal.error,
    anilistError: anilist.error,
    mangadexError: mangadex.error,
    yamtrackError: yamtrack.error,
    commitError: commit.error,
    reset: () => {
      mal.reset();
      anilist.reset();
      mangadex.reset();
      yamtrack.reset();
      commit.reset();
    },
  };
}
