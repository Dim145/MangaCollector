import { useMutation, useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import axios from "@/utils/axios.js";
import { cacheSettings, readSettings, SETTINGS_KEY, db } from "@/lib/db.js";
import { queryClient } from "@/lib/queryClient.js";
import { enqueueSettingsUpdate } from "@/lib/sync.js";

/**
 * Live user settings from Dexie, refreshed from backend in the background.
 * Same loading semantics as other data hooks — see useLibrary for details.
 */
export function useUserSettings() {
  const row = useLiveQuery(() => db.settings.get(SETTINGS_KEY), []);

  const query = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data } = await axios.get(`/api/user/settings`);
      await cacheSettings(data);
      return data;
    },
  });

  const settings = row
    ? Object.fromEntries(Object.entries(row).filter(([k]) => k !== "key"))
    : null;

  const dexieReady = row !== undefined;
  const pending = query.isPending;

  return {
    data: settings,
    isInitialLoad: !dexieReady || (row === null && pending),
    isRefetching: query.isFetching && !pending && dexieReady && row !== null,
    isEmpty: dexieReady && row === null && !pending,
    isLoading: !dexieReady || (row === null && pending),
  };
}

export async function bootstrapSettings() {
  // Called on app start so non-reactive code paths can read settings synchronously.
  return await readSettings();
}

export function useUpdateSettings() {
  return useMutation({
    mutationFn: async (settings) => {
      await enqueueSettingsUpdate(settings);
      return settings;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}
