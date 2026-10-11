import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ActionMenu from "./ActionMenu.jsx";

/*
 * A row's actions behind one button: each entry named in words, the
 * menu opening on its first entry that can be used, arrows moving
 * between the usable ones, a choice closing it.
 */

function renderMenu() {
  const up = vi.fn();
  const remove = vi.fn();
  render(
    <ActionMenu
      label="Actions — Shelf B"
      items={[
        { id: "up", glyph: "↑", label: "Move up", disabled: true, onSelect: up },
        { id: "edit", glyph: "改", label: "Rename", onSelect: vi.fn() },
        { id: "delete", glyph: "消", label: "Delete", danger: true, onSelect: remove },
      ]}
    />,
  );
  return { up, remove };
}

describe("ActionMenu", () => {
  it("is a menu button named by its words, not its glyph", () => {
    renderMenu();
    const button = screen.getByRole("button", { name: "Actions — Shelf B" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("opens on its first usable entry and moves with the arrows", async () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Actions — Shelf B" }));
    const menu = screen.getByRole("menu", { name: "Actions — Shelf B" });
    expect(screen.getByRole("menuitem", { name: /move up/i })).toBeDisabled();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /rename/i })),
    );
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /delete/i }));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /rename/i }));
  });

  it("runs the choice and closes", () => {
    const { remove } = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Actions — Shelf B" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
