import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider, loadLanguage } from "@/i18n/index.jsx";
import SortMenu from "./SortMenu.jsx";

/*
 * The menu is a controlled component: it names the current order on
 * its button, hands a `{ key, dir }` back on every choice, and never
 * flips direction as a side effect of picking a key — that is the
 * footer button's job.
 */

beforeAll(async () => {
  await loadLanguage("en");
});

function renderMenu(props) {
  const onChange = vi.fn();
  render(
    <I18nProvider lang="en">
      <SortMenu sort={{ key: "title", dir: "asc" }} onChange={onChange} {...props} />
    </I18nProvider>,
  );
  return onChange;
}

describe("SortMenu", () => {
  it("names the current order on the button and opens a radio list", () => {
    renderMenu();
    const btn = screen.getByRole("button", { name: /open sort menu/i });
    expect(btn).toHaveTextContent("Title");
    expect(btn).toHaveTextContent("↑");
    fireEvent.click(btn);
    expect(screen.getByRole("dialog", { name: /order/i })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(8);
    expect(screen.getByRole("radio", { name: /title/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("picks a key with its natural direction", () => {
    const onChange = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /open sort menu/i }));
    fireEvent.click(screen.getByRole("radio", { name: /date added/i }));
    expect(onChange).toHaveBeenCalledWith({ key: "added", dir: "desc" });
  });

  it("ignores a click on the key that is already selected", () => {
    const onChange = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /open sort menu/i }));
    fireEvent.click(screen.getByRole("radio", { name: /title/i }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("flips the direction from the footer", () => {
    const onChange = renderMenu({ sort: { key: "added", dir: "desc" } });
    const btn = screen.getByRole("button", { name: /open sort menu/i });
    expect(btn).toHaveTextContent("Date added");
    expect(btn).toHaveTextContent("↓");
    fireEvent.click(btn);
    expect(screen.getByText("Descending")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /flip order/i }));
    expect(onChange).toHaveBeenCalledWith({ key: "added", dir: "asc" });
  });

  it("closes on Escape", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /open sort menu/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyUp(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
