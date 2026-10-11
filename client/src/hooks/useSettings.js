import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { readSettings, SETTINGS_KEY, db } from "@/lib/db.js";
import { settingsQuery } from "@/lib/coreQueries.js";
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

  // 一 · One object per distinct row. Rebuilt on every render, it was a
  // new value each time this hook re-rendered — every `isFetching` flip
  // of the settings query, every Dexie emission — so the context built
  // from it (`App.jsx`) changed identity and re-rendered the root of
  // whatever page was open. Keyed on the row's content rather than its
  // identity, because Dexie hands back a fresh object even when a
  // refetch rewrote the same values.
  const rowKey = row === undefined ? "" : JSON.stringify(row);
  const settings = useMemo(() => {
    if (!rowKey) return null;
    const parsed = JSON.parse(rowKey);
    if (!parsed) return null;
    return Object.fromEntries(
      Object.entries(parsed).filter(([k]) => k !== "key"),
    );
  }, [rowKey]);

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
    // No invalidation: the Dexie write inside `enqueueSettingsUpdate` is
    // what the page renders, and the flush caches the server's answer to
    // its own POST. Invalidating here sent a GET that raced the flush and
    // could only ever come back with the value being replaced.
  });
}
