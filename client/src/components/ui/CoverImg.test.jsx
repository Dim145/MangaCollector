import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CoverImg from "./CoverImg.jsx";

/*
 * The bare-image twin of `CoverImage`: renditions in `srcset`, the stored
 * address as the fallback, and nothing else changed about the `<img>`.
 */
const MD =
  "https://uploads.mangadex.org/covers/1f5a94b3-08f9-4b58-8354-db5cf22043d6/198fec8c-a7f6-4045-8cf6-5c782fd87c72.jpg";

describe("CoverImg", () => {
  it("asks for the renditions that fit the slot", () => {
    render(<CoverImg src={MD} sizes="40px" alt="t1" className="h-14 w-10" />);
    const img = screen.getByRole("img", { name: "t1" });
    expect(img.getAttribute("srcset")).toBe(`${MD}.256.jpg 256w, ${MD}.512.jpg 512w`);
    expect(img).toHaveAttribute("sizes", "40px");
    expect(img).toHaveAttribute("class", "h-14 w-10");
  });

  it("falls back to the stored address, then to the caller's onError", () => {
    const onError = vi.fn();
    render(<CoverImg src={MD} alt="t1" onError={onError} />);
    const img = screen.getByRole("img");
    fireEvent.error(img);
    expect(img).toHaveAttribute("src", MD);
    expect(img).not.toHaveAttribute("srcset");
    expect(onError).not.toHaveBeenCalled();
    fireEvent.error(img);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("leaves an address with no renditions alone", () => {
    render(<CoverImg src="/api/user/storage/poster/4" alt="p" />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "/api/user/storage/poster/4");
    expect(img).not.toHaveAttribute("srcset");
    expect(img).not.toHaveAttribute("sizes");
  });
});
