import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queryClient.js", () => ({
  queryClient: { invalidateQueries: vi.fn(), setQueryData: vi.fn(), removeQueries: vi.fn() },
}));

const USD = { code: "USD", symbol: "$", separator: ",", decimal: ".", precision: 2, format: "!#", negativePattern: "-!#" };
const mutateAsync = vi.fn(async () => ({}));

vi.mock("@/hooks/useSettings.js", () => ({
  useUserSettings: () => ({
    data: { currency: USD, adult_content_level: 0, titleType: "Default", theme: "dark", language: "en", sound_enabled: false },
    isInitialLoad: false,
  }),
  useUpdateSettings: () => ({ mutateAsync }),
}));
vi.mock("@/hooks/useOnline.js", () => ({ useOnline: () => true }));
vi.mock("@/hooks/usePendingCount.js", () => ({ usePendingCount: () => 0 }));
vi.mock("@/lib/sync.js", () => ({
  forceResyncFromServer: vi.fn(),
  notifySyncError: vi.fn(),
  notifySyncInfo: vi.fn(),
}));

const { db } = await import("@/lib/db.js");
const { I18nProvider, loadLanguage, loadNamespaces } = await import("@/i18n/index.jsx");
const { PAGE_NAMESPACES } = await import("@/i18n/split.js");
const { default: SettingsPage } = await import("./SettingsPage.jsx");

/*
 * The whole page: clicking a currency either switches at once (no
 * saved price) or asks first (a price above zero exists), and the
 * server only hears about it after the answer.
 */

beforeAll(async () => {
  // jsdom has no IntersectionObserver; the page uses one to track which chapter is on screen.
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
  await loadLanguage("en");
  await loadNamespaces(PAGE_NAMESPACES.SettingsPage);
});

beforeEach(async () => {
  mutateAsync.mockClear();
  await db.volumes.clear();
  await db.coffrets.clear();
});

function renderPage() {
  // Unrelated sections of the page fetch on their own (public profile, api keys): give them a client
  // that never retries, and let their requests fail quietly.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <I18nProvider lang="en">
          <SettingsPage />
        </I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sent = () => mutateAsync.mock.calls.map((c) => c[0].currency?.code);

describe("SettingsPage · switching the display currency", () => {
  it("switches without a question when no price above zero is saved", async () => {
    await db.volumes.bulkPut([{ id: 1, mal_id: 1, vol_num: 1, price: "0.00" }, { id: 2, mal_id: 1, vol_num: 2, price: null }]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /JPY/ }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual(["JPY"]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks first when a price is saved, and sends nothing until the answer", async () => {
    await db.volumes.bulkPut([{ id: 1, mal_id: 1, vol_num: 1, price: "12.50" }, { id: 2, mal_id: 1, vol_num: 2, price: "7.00" }]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /JPY/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/2 saved prices will keep exactly the same numbers/);
    expect(dialog.textContent).toMatch(/A price shown as \$12\.50 will read ¥13\./);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("Cancel leaves the currency alone and sends nothing", async () => {
    await db.volumes.bulkPut([{ id: 1, mal_id: 1, vol_num: 1, price: "12.50" }]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /JPY/ }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("confirming sends the currency, once", async () => {
    await db.volumes.bulkPut([{ id: 1, mal_id: 1, vol_num: 1, price: "12.50" }]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /JPY/ }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Switch to JPY" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual(["JPY"]);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("clicking the currency already in use asks nothing and sends nothing", async () => {
    await db.volumes.bulkPut([{ id: 1, mal_id: 1, vol_num: 1, price: "12.50" }]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /USD/ }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
