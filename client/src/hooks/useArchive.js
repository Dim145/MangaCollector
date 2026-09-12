import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "@/utils/axios.js";

/**
 * 写本 · Archive hook — export (JSON / CSV) and merge-import.
 *
 * Exports call the download endpoints and stream the response through
 * an in-memory Blob → <a download> clicks, which lets the user save
 * the file without leaving the Settings page. Filename comes from the
 * server's Content-Disposition header.
 *
 * Imports go through two mutations that share the same payload:
 *   preview(bundle, mode) → { added, skipped_conflict, replaced, ... }  (dry_run=true)
 *   commit(bundle, mode)  → same shape, but writes are applied
 *
 * `mode` is the server's conflict policy for series already in the
 * library (matched on positive mal_id):
 *   "merge"   — keep what's there, count the bundle's copy as a conflict
 *   "replace" — drop the local series (volumes, coffrets) and take the
 *               bundle's copy wholesale; this is the "restore a backup"
 *               path, so the UI makes the user opt into it explicitly.
 */
export const IMPORT_MODES = ["merge", "replace"];

/** Body of POST /api/user/import — one place to keep the wire shape. */
export function importPayload(bundle, mode, dryRun) {
  return {
    dry_run: dryRun,
    mode: IMPORT_MODES.includes(mode) ? mode : "merge",
    bundle,
  };
}

export function useArchive() {
  const qc = useQueryClient();
  const [isExporting, setExporting] = useState(false);

  const download = async (format) => {
    setExporting(true);
    try {
      const { data, headers } = await axios.get(
        `/api/user/export.${format}`,
        { responseType: "blob" },
      );
      const disposition = headers?.["content-disposition"] ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename =
        match?.[1] ?? `mangacollector-export.${format}`;
      const url = URL.createObjectURL(data);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        // Delay-revoke so Safari can still pick up the blob.
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
    } finally {
      setExporting(false);
    }
  };

  const preview = useMutation({
    mutationFn: async ({ bundle, mode }) => {
      const { data } = await axios.post(
        "/api/user/import",
        importPayload(bundle, mode, true),
      );
      return data;
    },
  });

  const commit = useMutation({
    mutationFn: async ({ bundle, mode }) => {
      const { data } = await axios.post(
        "/api/user/import",
        importPayload(bundle, mode, false),
      );
      // After a successful import the local Dexie cache is stale —
      // invalidate the big queries so the next render re-fetches.
      qc.invalidateQueries({ queryKey: ["library"] });
      qc.invalidateQueries({ queryKey: ["volumes-all"] });
      return data;
    },
  });

  return {
    exportJson: () => download("json"),
    exportCsv: () => download("csv"),
    isExporting,
    preview: (bundle, mode = "merge") => preview.mutateAsync({ bundle, mode }),
    isPreviewing: preview.isPending,
    previewError: preview.error,
    commit: (bundle, mode = "merge") => commit.mutateAsync({ bundle, mode }),
    isCommitting: commit.isPending,
    commitError: commit.error,
    reset: () => {
      preview.reset();
      commit.reset();
    },
  };
}
