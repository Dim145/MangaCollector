import { Suspense, useEffect, useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { lazyRoute } from "./lazyRoute.js";

/*
 * 待 · A page loaded before its render must render without suspending:
 * a suspension on a cold start commits the loading screen, and React 19
 * then holds the page back for 300 ms. A page nobody loaded still goes
 * through `React.lazy`, and a mounted page is never swapped for another
 * element type — that would remount it.
 */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Page({ label = "page" }) {
  return <p>{label}</p>;
}

describe("lazyRoute", () => {
  it("renders a preloaded page directly, without the fallback", async () => {
    const Route = lazyRoute(() => Promise.resolve({ default: Page }));
    await Route.preload();
    expect(Route.isReady()).toBe(true);
    const fallback = vi.fn(() => <p>loading</p>);
    const Fallback = () => fallback();
    render(
      <Suspense fallback={<Fallback />}>
        <Route label="ready" />
      </Suspense>,
    );
    // Synchronously there — no await between render and assertion.
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back to React.lazy for a page nobody loaded", async () => {
    const gate = deferred();
    const factory = vi.fn(() => gate.promise);
    const Route = lazyRoute(factory);
    render(
      <Suspense fallback={<p>loading</p>}>
        <Route label="late" />
      </Suspense>,
    );
    expect(screen.getByText("loading")).toBeInTheDocument();
    await act(async () => gate.resolve({ default: Page }));
    expect(await screen.findByText("late")).toBeInTheDocument();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("imports once however many callers ask", async () => {
    const factory = vi.fn(() => Promise.resolve({ default: Page }));
    const Route = lazyRoute(factory);
    await Promise.all([Route.preload(), Route.preload(), Route.preload()]);
    await Route.preload();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("is ready only once what it needs beside the module has loaded too", async () => {
    const text = deferred();
    const Route = lazyRoute(() => Promise.resolve({ default: Page }), {
      before: () => text.promise,
    });
    const loading = Route.preload();
    await Promise.resolve();
    expect(Route.isReady()).toBe(false);
    text.resolve();
    await loading;
    expect(Route.isReady()).toBe(true);
    render(
      <Suspense fallback={<p>loading</p>}>
        <Route label="with its text" />
      </Suspense>,
    );
    expect(screen.getByText("with its text")).toBeInTheDocument();
  });

  it("forgets a failed import so the next attempt tries again", async () => {
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module"))
      .mockResolvedValueOnce({ default: Page });
    const Route = lazyRoute(factory);
    await expect(Route.preload()).rejects.toThrow(/dynamically imported module/);
    expect(Route.isReady()).toBe(false);
    await expect(Route.preload()).resolves.toBe(Page);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("keeps a page mounted through React.lazy when it later becomes ready", async () => {
    const mounts = vi.fn();
    function Counter() {
      const [n, setN] = useState(0);
      useEffect(() => {
        mounts();
      }, []);
      return (
        <button type="button" onClick={() => setN(n + 1)}>
          clicks {n}
        </button>
      );
    }
    const gate = deferred();
    const Route = lazyRoute(() => gate.promise);
    let bump;
    function Shell() {
      const [, setTick] = useState(0);
      bump = () => setTick((t) => t + 1);
      return (
        <Suspense fallback={<p>loading</p>}>
          <Route />
        </Suspense>
      );
    }
    render(<Shell />);
    await act(async () => gate.resolve({ default: Counter }));
    const button = await screen.findByRole("button");
    act(() => button.click());
    expect(button).toHaveTextContent("clicks 1");
    // The page is ready now; a parent re-render must not swap the lazy
    // wrapper for the page itself, which would remount it.
    act(() => bump());
    expect(screen.getByRole("button")).toHaveTextContent("clicks 1");
    expect(mounts).toHaveBeenCalledTimes(1);
  });
});
