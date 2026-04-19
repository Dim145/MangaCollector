import { useMutation, useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import axios from "@/utils/axios.js";
import { cacheSettings, readSettings, SETTINGS_KEY, db } from "@/lib/db.js";
import { queryClient } from "@/lib/queryClient.js";
import { enqueueSettingsUpdate } from "@/lib/sync.js";

/**
 * Live user settings from Dexie, refreshed from backend in the background.
 */
export function useUserSettings() {
  const row = useLiveQuery(() => db.settings.get(SETTINGS_KEY), []);

  useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data } = await axios.get(`/api/user/settings`);
      await cacheSettings(data);
      return data;
    },
  });

  const settings = row
    ? Object.fromEntries(
        Object.entries(row).filter(([k]) => k !== "key")
      )
    : null;

  return { data: settings, isLoading: row === undefined };
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
