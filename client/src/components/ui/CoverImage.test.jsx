import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CoverImage from "./CoverImage.jsx";

/*
 * First component test in the suite. `CoverImage` is the primitive
 * behind every cover on every shelf, so its contract is worth pinning:
 * the LQIP swatch, the lazy mount, the fallback glyph, and — the
 * regression that motivated the file — a `fetchPriority` prop that
 * React 19 accepts silently. The previous lowercase spelling made
 * React emit "Invalid DOM property `fetchpriority`" on every cover.
 */

/** IntersectionObserver that reports every target as visible at once. */
class ImmediateObserver {
  constructor(cb) {
    this.cb = cb;
  }
  observe(el) {
    this.cb([{ isIntersecting: true, target: el }], this);
  }
  unobserve() {}
  disconnect() {}
}

let errorSpy;

beforeEach(() => {
  globalThis.IntersectionObserver = ImmediateObserver;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete globalThis.IntersectionObserver;
});

describe("CoverImage", () => {
  it("renders the image once the slot is near the viewport", () => {
    render(<CoverImage src="https://cdn/x.jpg" alt="Berserk" />);
    expect(screen.getByRole("img", { name: "Berserk" })).toHaveAttribute(
      "src",
      "https://cdn/x.jpg",
    );
  });

  it("emits no React DOM-property warning for fetchPriority", () => {
    // The regression guard. With the lowercase `fetchpriority` prop,
    // React 19 logs an "Invalid DOM property" error for every cover.
    render(<CoverImage src="https://cdn/x.jpg" alt="x" fetchPriority="high" />);
    const domWarnings = errorSpy.mock.calls.filter((args) =>
      String(args[0]).includes("Invalid DOM property"),
    );
    expect(domWarnings).toEqual([]);
  });

  it("forwards fetchPriority to the DOM as the lowercase HTML attribute", () => {
    render(<CoverImage src="https://cdn/x.jpg" alt="x" fetchPriority="high" />);
    expect(screen.getByRole("img")).toHaveAttribute("fetchpriority", "high");
  });

  it("defers fetching with native lazy loading and async decoding", () => {
    render(<CoverImage src="https://cdn/x.jpg" alt="x" />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
  });

  it("reserves the 2:3 slot through intrinsic dimensions by default", () => {
    render(<CoverImage src="https://cdn/x.jpg" alt="x" />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("width", "200");
    expect(img).toHaveAttribute("height", "300");
  });

  it("does not send a Referer to cover hosts", () => {
    render(<CoverImage src="https://cdn/x.jpg" alt="x" />);
    expect(screen.getByRole("img")).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("paints a deterministic LQIP swatch behind the image from paletteSeed", () => {
    const { container } = render(
      <CoverImage src="https://cdn/x.jpg" alt="x" paletteSeed={7} />,
    );
    const wrapper = container.querySelector("span");
    expect(wrapper.style.backgroundColor).toMatch(/^rgb\(/);
  });

  it("shows the kanji fallback when there is no src", () => {
    render(<CoverImage src={null} fallbackKanji="巻" />);
    expect(screen.getByText("巻")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("exposes the fallback as an accessible image when alt is given", () => {
    render(<CoverImage src={null} alt="Missing cover" />);
    expect(screen.getByRole("img", { name: "Missing cover" })).toBeInTheDocument();
  });

  it("hides a decorative fallback from assistive tech when alt is empty", () => {
    const { container } = render(<CoverImage src={null} />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("falls back to the glyph when the image fails to load", () => {
    render(<CoverImage src="https://cdn/broken.jpg" alt="x" fallbackKanji="巻" />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("巻")).toBeInTheDocument();
  });

  it("does not mount the image until the observer reports it near", () => {
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    render(<CoverImage src="https://cdn/x.jpg" alt="x" />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});
