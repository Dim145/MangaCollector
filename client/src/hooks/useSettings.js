import { useMutation, useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { readSettings, SETTINGS_KEY, db } from "@/lib/db.js";
import { settingsQuery } from "@/lib/coreQueries.js";
import { queryClient } from "@/lib/queryClient.js";
import { enqueueSettingsUpdate } from "@/lib/sync.js";
import { useAuth } from "@/hooks/useAuth.js";

/**
 * Live user settings from Dexie, refreshed from backend in the background.
 * Same loading semantics as other data hooks — see useLibrary for details.
 */
export function useUserSettings() {
  const row = useLiveQuery(() => db.settings.get(SETTINGS_KEY), []);

  // 錠 · These are one account's settings, so there is no point asking
  // for them before we know there is an account: an anonymous visitor
  // got a 401 on the landing and again on /log-in. The Dexie read above
  // is untouched, so a returning user still paints from cache at once —
  // only the revalidation waits, and it waits on a probe (`/auth/user`)
  // that was already in flight beside it.
  const { isAuthenticated } = useAuth();
  const query = useQuery({ ...settingsQuery, enabled: isAuthenticated });

  const settings = row
    ? Object.fromEntries(Object.entries(row).filter(([k]) => k !== "key"))
    : null;

  const dexieReady = row !== undefined;
  // A disabled query stays `pending` for ever; that is not loading.
  const pending = query.isPending && isAuthenticated;

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
