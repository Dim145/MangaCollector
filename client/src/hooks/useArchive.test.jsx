import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/axios.js", () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: { added: 1 } })),
  },
}));

const axios = (await import("@/utils/axios.js")).default;
const { IMPORT_MODES, importPayload, useArchive } = await import(
  "./useArchive.js"
);

/*
 * The import endpoint's wire shape is the contract with
 * `handlers/archive.rs`: `mode` decides whether a series already in
 * the library is kept ("merge") or overwritten from the bundle
 * ("replace"). A typo here would silently fall back to the server's
 * default and turn a "restore my backup" into a no-op — so the payload
 * builder and both mutations are pinned.
 */

const BUNDLE = { version: 2, library: [{ name: "Berserk", mal_id: 2 }] };

function wrapper({ children }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  axios.post.mockClear();
});

describe("importPayload", () => {
  it("lists exactly the two policies the server knows", () => {
    expect(IMPORT_MODES).toEqual(["merge", "replace"]);
  });

  it("carries mode, dry_run and the bundle verbatim", () => {
    expect(importPayload(BUNDLE, "replace", true)).toEqual({
      dry_run: true,
      mode: "replace",
      bundle: BUNDLE,
    });
  });

  it.each([[undefined], [null], ["overwrite"], [""]])(
    "falls back to merge for the unknown mode %p",
    (mode) => {
      expect(importPayload(BUNDLE, mode, false).mode).toBe("merge");
    },
  );
});

describe("useArchive import mutations", () => {
  it("previews as a merge dry run by default", async () => {
    const { result } = renderHook(() => useArchive(), { wrapper });
    await act(() => result.current.preview(BUNDLE));
    expect(axios.post).toHaveBeenCalledWith("/api/user/import", {
      dry_run: true,
      mode: "merge",
      bundle: BUNDLE,
    });
  });

  it("forwards the replace policy to the dry run", async () => {
    const { result } = renderHook(() => useArchive(), { wrapper });
    await act(() => result.current.preview(BUNDLE, "replace"));
    expect(axios.post.mock.calls[0][1]).toMatchObject({
      dry_run: true,
      mode: "replace",
    });
  });

  it("commits with the same policy the preview was shown for", async () => {
    const { result } = renderHook(() => useArchive(), { wrapper });
    const data = await act(() => result.current.commit(BUNDLE, "replace"));
    expect(axios.post).toHaveBeenCalledWith("/api/user/import", {
      dry_run: false,
      mode: "replace",
      bundle: BUNDLE,
    });
    expect(data).toEqual({ added: 1 });
  });

  it("surfaces a server rejection through previewError", async () => {
    axios.post.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useArchive(), { wrapper });
    await act(async () => {
      await expect(result.current.preview(BUNDLE)).rejects.toThrow("boom");
    });
    // The mutation's error state lands on the next render, not
    // synchronously with the rejected promise.
    await waitFor(() =>
      expect(result.current.previewError).toBeInstanceOf(Error),
    );
  });
});
