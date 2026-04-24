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
 *   preview(bundle) → { added, skipped_conflict, ... }  (dry_run=true)
 *   commit(bundle)  → same shape, but writes are applied
 */
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
    mutationFn: async (bundle) => {
      const { data } = await axios.post("/api/user/import", {
        dry_run: true,
        bundle,
      });
      return data;
    },
  });

  const commit = useMutation({
    mutationFn: async (bundle) => {
      const { data } = await axios.post("/api/user/import", {
        dry_run: false,
        bundle,
      });
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
    preview: preview.mutateAsync,
    isPreviewing: preview.isPending,
    previewError: preview.error,
    commit: commit.mutateAsync,
    isCommitting: commit.isPending,
    commitError: commit.error,
    reset: () => {
      preview.reset();
      commit.reset();
    },
  };
}
