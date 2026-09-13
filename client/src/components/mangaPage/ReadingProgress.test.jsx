import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, loadLanguage } from "@/i18n/index.jsx";

vi.mock("@/hooks/useLibrary.js", () => ({
  useUpdateMangaMeta: vi.fn(),
  useStartReread: vi.fn(),
}));

const { useUpdateMangaMeta, useStartReread } =
  await import("@/hooks/useLibrary.js");
const ReadingProgress = (await import("./ReadingProgress.jsx")).default;

/*
 * The block is an override surface over server-derived state: every
 * chip and date saves immediately through the library patch (offline
 * path), and "read again" is a two-step action gated on having
 * finished the series once — the same rule the server applies.
 */

let meta;
let reread;

beforeAll(async () => {
  await loadLanguage("en");
});

beforeEach(() => {
  meta = { mutate: vi.fn(), isPending: false };
  reread = { mutate: vi.fn(), isPending: false, isError: false };
  useUpdateMangaMeta.mockReturnValue(meta);
  useStartReread.mockReturnValue(reread);
});

const series = (over) => ({
  mal_id: 13,
  volumes: 12,
  reading_status: "reading",
  started_reading_at: "2025-01-05",
  finished_reading_at: null,
  times_read: 0,
  ...over,
});

function renderIt(row) {
  return render(
    <I18nProvider lang="en">
      <ReadingProgress series={row} />
    </I18nProvider>,
  );
}

describe("ReadingProgress", () => {
  it("shows the current state and saves a new one on click", () => {
    renderIt(series());
    expect(screen.getByRole("radio", { name: /reading/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("radio", { name: /paused/i }));
    expect(meta.mutate).toHaveBeenCalledWith({
      mal_id: 13,
      reading_status: "paused",
    });
  });

  it("clears the state when the active chip is clicked again", () => {
    renderIt(series());
    fireEvent.click(screen.getByRole("radio", { name: /reading/i }));
    expect(meta.mutate).toHaveBeenCalledWith({
      mal_id: 13,
      reading_status: "",
    });
  });

  it("saves dates as YYYY-MM-DD and clears them with an empty input", () => {
    renderIt(series());
    const finished = screen.getByLabelText(/^finished/i);
    fireEvent.change(finished, { target: { value: "2025-06-01" } });
    expect(meta.mutate).toHaveBeenCalledWith({
      mal_id: 13,
      finished_reading_at: "2025-06-01",
    });
    const started = screen.getByLabelText(/^started/i);
    fireEvent.change(started, { target: { value: "" } });
    expect(meta.mutate).toHaveBeenCalledWith({
      mal_id: 13,
      started_reading_at: null,
    });
  });

  it("keeps read-again out of reach until the series was finished once", () => {
    renderIt(series());
    expect(screen.getByRole("button", { name: /read again/i })).toBeDisabled();
    expect(screen.getByText(/not finished yet/i)).toBeInTheDocument();
  });

  it("asks before starting over, then calls the reread mutation", () => {
    renderIt(
      series({
        reading_status: "completed",
        finished_reading_at: "2025-06-01",
        times_read: 1,
      }),
    );
    expect(screen.getByText(/read through once/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /read again/i }));
    expect(reread.mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/start over\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /yes, start over/i }));
    expect(reread.mutate).toHaveBeenCalledWith(13);
  });

  it("counts read-throughs in the header", () => {
    renderIt(series({ times_read: 3 }));
    expect(screen.getByText("Read through 3×")).toBeInTheDocument();
  });
});
