import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import VirtualVolumeGrid, {
  VIRTUALIZE_THRESHOLD,
} from "./VirtualVolumeGrid.jsx";

/*
 * jsdom has no layout, so the windowed branch can't be measured here;
 * its geometry is verified in the browser against a 110-volume series.
 * What IS pinned: the below-threshold branch is byte-for-byte the CSS
 * grid it replaced, and `renderTile` receives what each branch promises.
 */

const vols = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, vol_num: i + 1 }));
const tile = (vol) => (
  <div key={vol.id} data-testid="tile">
    v{vol.vol_num}
  </div>
);

describe("VirtualVolumeGrid (plain branch)", () => {
  it("renders every tile below the threshold", () => {
    render(
      <VirtualVolumeGrid vols={vols(12)} shelf={false} renderTile={tile} />,
    );
    expect(screen.getAllByTestId("tile")).toHaveLength(12);
  });

  it("keeps the ledger grid classes the simple grid used", () => {
    const { container } = render(
      <VirtualVolumeGrid vols={vols(3)} shelf={false} renderTile={tile} />,
    );
    expect(container.firstChild.className).toBe(
      "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3",
    );
  });

  it("keeps the shelf grid classes the simple grid used", () => {
    const { container } = render(
      <VirtualVolumeGrid vols={vols(3)} shelf renderTile={tile} />,
    );
    expect(container.firstChild.className).toBe(
      "grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6",
    );
  });

  it("passes no busy callback below the threshold — nothing to pin", () => {
    const seen = [];
    render(
      <VirtualVolumeGrid
        vols={vols(2)}
        shelf={false}
        renderTile={(vol, onBusy) => {
          seen.push(onBusy);
          return tile(vol);
        }}
      />,
    );
    expect(seen).toEqual([undefined, undefined]);
  });

  it("switches to the windowed branch exactly at the threshold", () => {
    const { container } = render(
      <VirtualVolumeGrid
        vols={vols(VIRTUALIZE_THRESHOLD)}
        shelf={false}
        renderTile={tile}
      />,
    );
    // The windowed branch is a positioned container, not a CSS grid.
    expect(container.firstChild.style.position).toBe("relative");
    expect(container.firstChild.className).toBe("");
  });

  it("renders an empty grid for an empty segment", () => {
    const { container } = render(
      <VirtualVolumeGrid vols={[]} shelf={false} renderTile={tile} />,
    );
    expect(container.firstChild.children).toHaveLength(0);
  });
});
