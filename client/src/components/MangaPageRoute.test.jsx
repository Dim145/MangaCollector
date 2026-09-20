import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * 深 · The deep-link contract.
 *
 * `/mangapage?mal_id=…` is the URL printed on every shelf QR label, the
 * one a bookmark keeps and the one the command palette opens. It used to
 * bounce to /dashboard on any device whose Dexie cache did not already
 * hold the row — including the perfectly ordinary case of a cache that
 * simply had not finished loading. These tests pin that it asks the
 * server before giving up, and that it still gives up when the server
 * says the series is gone.
 */

vi.mock("@/hooks/useLibrary.js", () => ({ useLibrary: vi.fn() }));
vi.mock("@/lib/sync/outbox.js", () => ({ refetchLibraryEntry: vi.fn() }));
vi.mock("@/components/MangaPage.jsx", () => ({
  default: ({ manga }) => <div data-testid="manga-page">{manga.name}</div>,
}));
vi.mock("@/components/MangaPageSkeleton.jsx", () => ({
  default: () => <div data-testid="skeleton" />,
}));

const { useLibrary } = await import("@/hooks/useLibrary.js");
const { refetchLibraryEntry } = await import("@/lib/sync/outbox.js");
const MangaPageRoute = (await import("./MangaPageRoute.jsx")).default;

const ONE_PIECE = { mal_id: 13, name: "One Piece", volumes: 111 };

/** What `useLibrary` answers: `data` plus the loading ladder. */
function libraryAnswers(data, { isInitialLoad = false } = {}) {
  useLibrary.mockReturnValue({
    data,
    isInitialLoad,
    isRefetching: false,
    isEmpty: data.length === 0 && !isInitialLoad,
    isLoading: isInitialLoad,
  });
}

function renderAt(url, props = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/mangapage" element={<MangaPageRoute {...props} />} />
          <Route path="/dashboard" element={<div data-testid="dashboard" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  libraryAnswers([]);
  refetchLibraryEntry.mockResolvedValue(null);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("a deep link to a series", () => {
  it("renders straight from the cache when the row is there", () => {
    libraryAnswers([ONE_PIECE]);
    renderAt("/mangapage?mal_id=13");
    expect(screen.getByTestId("manga-page")).toHaveTextContent("One Piece");
    expect(refetchLibraryEntry).not.toHaveBeenCalled();
  });

  it("waits instead of redirecting while the cache is still loading", () => {
    libraryAnswers([], { isInitialLoad: true });
    renderAt("/mangapage?mal_id=13");
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();
    // Nothing is asked of the server until the cache has had its say.
    expect(refetchLibraryEntry).not.toHaveBeenCalled();
  });

  it("asks the server for the one row when the settled cache lacks it", async () => {
    // The device has a library — just not this series. Same shape as the
    // race the redirect used to lose: settled, non-empty, row missing.
    libraryAnswers([{ mal_id: 21, name: "Gintama" }]);
    refetchLibraryEntry.mockResolvedValue(ONE_PIECE);
    renderAt("/mangapage?mal_id=13");

    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("manga-page")).toHaveTextContent("One Piece"),
    );
    expect(refetchLibraryEntry).toHaveBeenCalledWith(13);
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();
  });

  it("redirects only once the server says the series is not there", async () => {
    // `refetchLibraryEntry` answers null for a row the server no longer
    // has — it replies with an empty array, never a 404.
    refetchLibraryEntry.mockResolvedValue(null);
    renderAt("/mangapage?mal_id=13");
    await waitFor(() =>
      expect(screen.getByTestId("dashboard")).toBeInTheDocument(),
    );
    expect(refetchLibraryEntry).toHaveBeenCalledWith(13);
  });

  it("redirects without asking anything when the URL names no series", () => {
    renderAt("/mangapage");
    expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    expect(refetchLibraryEntry).not.toHaveBeenCalled();
  });

  it("uses the row the previous page handed it, cache or no cache", () => {
    renderAt("/mangapage", { stateManga: { mal_id: 7, name: "Vagabond" } });
    expect(screen.getByTestId("manga-page")).toHaveTextContent("Vagabond");
    expect(refetchLibraryEntry).not.toHaveBeenCalled();
  });
});
