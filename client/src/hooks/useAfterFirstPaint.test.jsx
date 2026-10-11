import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAfterFirstPaint } from "./useAfterFirstPaint.js";

function Probe() {
  const painted = useAfterFirstPaint();
  return <p>{painted ? "after" : "first"}</p>;
}

describe("useAfterFirstPaint", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] }));
  afterEach(() => vi.useRealTimers());

  it("is false for the first paint and true after it", async () => {
    render(<Probe />);
    expect(screen.getByText("first")).toBeInTheDocument();
    // The frame: still the first paint.
    await act(async () => vi.advanceTimersToNextFrame());
    expect(screen.getByText("first")).toBeInTheDocument();
    // The task after it.
    await act(async () => vi.runOnlyPendingTimers());
    expect(screen.getByText("after")).toBeInTheDocument();
  });

  it("does nothing once unmounted", async () => {
    const { unmount } = render(<Probe />);
    unmount();
    await act(async () => {
      vi.advanceTimersToNextFrame();
      vi.runAllTimers();
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
