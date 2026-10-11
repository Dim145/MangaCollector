import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider, loadLanguage, loadNamespaces } from "@/i18n/index.jsx";
import { PAGE_NAMESPACES } from "@/i18n/split.js";
import FiltersSheet from "./FiltersSheet.jsx";
import { tagCounts } from "./viewOptions.js";

/*
 * The phone's filter sheet is controlled: it hands every choice back at
 * once (the grid behind is the preview), picks a key's natural
 * direction like the desktop menu, lets the active lens go on a second
 * tap, and can be closed by a button that says so.
 */

beforeAll(async () => {
  await loadLanguage("en");
  await loadNamespaces(PAGE_NAMESPACES.Dashboard);
});

const LIBRARY = [
  { mal_id: 1, genres: ["Action", "Drama"] },
  { mal_id: 2, genres: ["Action", " Comedy "] },
  { mal_id: 3, genres: ["Action", ""] },
];

function renderSheet(props = {}) {
  const handlers = {
    onClose: vi.fn(),
    onToggleTag: vi.fn(),
    onLens: vi.fn(),
    onSort: vi.fn(),
    onReset: vi.fn(),
  };
  render(
    <I18nProvider lang="en">
      <FiltersSheet
        open
        library={LIBRARY}
        activeTags={new Set()}
        lens={null}
        sort={{ key: "title", dir: "asc" }}
        resultsCount={3}
        {...handlers}
        {...props}
      />
    </I18nProvider>,
  );
  return handlers;
}

describe("tagCounts", () => {
  it("counts trimmed genres over the whole shelf, most common first", () => {
    expect(tagCounts(LIBRARY)).toEqual([
      { name: "Action", count: 3 },
      { name: "Comedy", count: 1 },
      { name: "Drama", count: 1 },
    ]);
    expect(tagCounts(undefined)).toEqual([]);
  });
});

describe("FiltersSheet", () => {
  it("is a dialog named by its title, with a visible Close button", () => {
    const { onClose } = renderSheet();
    const dialog = screen.getByRole("dialog", { name: "Narrow and order the shelf" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("picks a key in its natural direction and flips the direction apart", () => {
    const { onSort } = renderSheet();
    fireEvent.click(screen.getByRole("radio", { name: /date added/i }));
    expect(onSort).toHaveBeenLastCalledWith({ key: "added", dir: "desc" });
    fireEvent.click(screen.getByRole("radio", { name: /descending/i }));
    expect(onSort).toHaveBeenLastCalledWith({ key: "title", dir: "desc" });
  });

  it("turns a lens on", () => {
    const { onLens } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /recent/i, pressed: false }));
    expect(onLens).toHaveBeenLastCalledWith("recent");
  });

  it("releases the active lens on a second tap", () => {
    const { onLens } = renderSheet({ lens: "recent" });
    const active = screen.getByRole("button", { name: /recent/i, pressed: true });
    fireEvent.click(active);
    expect(onLens).toHaveBeenLastCalledWith(null);
  });

  it("toggles a genre as a checkbox carrying its count", () => {
    const { onToggleTag } = renderSheet({ activeTags: new Set(["Drama"]) });
    expect(screen.getByRole("checkbox", { name: /drama/i })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /action\s*3/i }));
    expect(onToggleTag).toHaveBeenCalledWith("Action");
  });

  it("offers a reset only when something is set, and counts the results", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: /reset/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Show results (3)" })).toBeEnabled();
  });

  it("resets when an order other than the default is set", () => {
    const { onReset } = renderSheet({ sort: { key: "added", dir: "desc" } });
    const reset = screen.getByRole("button", { name: /reset/i });
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("offers to select several series when the page can", () => {
    const onSelectSeries = vi.fn();
    renderSheet({ onSelectSeries });
    fireEvent.click(screen.getByRole("button", { name: /select several series/i }));
    expect(onSelectSeries).toHaveBeenCalledTimes(1);
  });
});
