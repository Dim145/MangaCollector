import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import BarChartSvg from "./BarChartSvg.jsx";
import RingChartSvg from "./RingChartSvg.jsx";

/*
 * 図 · The stats page's charts, drawn without a chart library. What is
 * pinned here is what a reader relies on: one shape per value, a text
 * for every value that a screen reader can reach, and the keyboard path
 * through the chart. jsdom lays nothing out, so the width the charts
 * draw against is stubbed.
 */
let widthDescriptor;
beforeEach(() => {
  widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 400,
  });
});
afterEach(() => {
  if (widthDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", widthDescriptor);
  }
});

const MONTHS = [
  { label: "janv.", count: 2 },
  { label: "févr.", count: 0 },
  { label: "mars", count: 7 },
];

function bars(props = {}) {
  return render(
    <BarChartSvg
      data={MONTHS}
      value={(d) => d.count}
      label={(d) => d.label}
      height={192}
      integers
      barFill={(d) => (d.count === 7 ? "url(#peak)" : "url(#bar)")}
      describe={(d) => `${d.label} · ${d.count} lus`}
      ariaLabel="Lecture"
      {...props}
    />,
  );
}

const live = (container) => container.querySelector("[aria-live]");

describe("BarChartSvg", () => {
  it("draws a bar per month, the peak in its own fill, and a round axis", () => {
    const { container } = bars();
    const paths = container.querySelectorAll("svg path");
    expect(paths).toHaveLength(3);
    expect(paths[2]).toHaveAttribute("fill", "url(#peak)");
    expect(paths[0]).toHaveAttribute("fill", "url(#bar)");
    // A month with nothing read has no shape at all, not a sliver.
    expect(paths[1].getAttribute("d")).toBe("");
    const ticks = [...container.querySelectorAll("svg text")].map((t) => t.textContent);
    expect(ticks).toEqual(expect.arrayContaining(["0", "2", "8", "janv.", "mars"]));
  });

  it("gives every value a line a screen reader can reach", () => {
    bars();
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("janv. · 2 lus");
    expect(table).toHaveTextContent("févr. · 0 lus");
    expect(table).toHaveTextContent("mars · 7 lus");
    expect(screen.getByRole("group", { name: "Lecture" })).toHaveAttribute("tabindex", "0");
  });

  it("walks the bars with the arrow keys, wraps, and lets go on Escape", () => {
    const { container } = bars();
    const chart = screen.getByRole("group", { name: "Lecture" });
    act(() => chart.focus());
    expect(live(container)).toHaveTextContent("janv. · 2 lus");
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(live(container)).toHaveTextContent("févr. · 0 lus");
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(live(container)).toHaveTextContent("mars · 7 lus");
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(live(container)).toHaveTextContent("");
  });

  it("does not open on the first bar when the focus came from a click", () => {
    const { container } = bars();
    const chart = screen.getByRole("group", { name: "Lecture" });
    fireEvent.pointerDown(chart);
    act(() => chart.focus());
    expect(live(container)).toHaveTextContent("");
  });

  it("draws a missing amount as an empty band rather than NaN", () => {
    const { container } = bars({
      data: [{ label: "a", count: undefined }, { label: "b", count: 3 }],
    });
    const d = [...container.querySelectorAll("svg path")].map((p) => p.getAttribute("d"));
    expect(d[0]).toBe("");
    expect(d[1]).not.toContain("NaN");
  });
});

const GENRES = [
  { name: "Action", value: 6 },
  { name: "Vide", value: 0 },
  { name: "Romance", value: 2 },
];

function ring() {
  return render(
    <RingChartSvg
      data={GENRES}
      height={224}
      palette={["red", "gold"]}
      describe={(d, pct) => `${d.name} · ${d.value} (${pct}%)`}
      ariaLabel="Genres"
    />,
  );
}

describe("RingChartSvg", () => {
  it("draws a segment per non-zero share and names every entry in the legend", () => {
    const { container } = ring();
    const paths = container.querySelectorAll("svg path");
    expect(paths).toHaveLength(2);
    // The palette follows the entry, not the drawn segment.
    expect(paths[0]).toHaveAttribute("fill", "red");
    expect(paths[1]).toHaveAttribute("fill", "red");
    expect(container.querySelector("ul")).toHaveTextContent("ActionVideRomance");
    expect(screen.getByRole("table")).toHaveTextContent("Action · 6 (75%)");
    expect(screen.getByRole("table")).toHaveTextContent("Romance · 2 (25%)");
  });

  it("steps through the drawn segments only, and reads the active one in the hole", () => {
    const { container } = ring();
    const chart = screen.getByRole("group", { name: "Genres" });
    act(() => chart.focus());
    expect(live(container)).toHaveTextContent("Action · 6 (75%)");
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(live(container)).toHaveTextContent("Romance · 2 (25%)");
    expect(container).toHaveTextContent("25%");
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(live(container)).toHaveTextContent("Action · 6 (75%)");
  });

  it("follows the pointer from segment to segment", () => {
    const { container } = ring();
    const paths = container.querySelectorAll("svg path");
    fireEvent.pointerEnter(paths[1]);
    expect(live(container)).toHaveTextContent("Romance · 2 (25%)");
  });
});
