import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, loadLanguage } from "@/i18n/index.jsx";

vi.mock("@/hooks/useArchive.js", () => ({
  useArchive: vi.fn(),
}));

const { useArchive } = await import("@/hooks/useArchive.js");
const ArchiveSection = (await import("./ArchiveSection.jsx")).default;

/*
 * The import modal's second step lets the user choose what happens to
 * a series that is already in the library. "Keep mine" (merge) is the
 * safe default; "Take the file's" (replace) rewrites the matched series
 * from the bundle and is how a backup gets restored. Every flip of that
 * choice must re-run the dry run so the counts under it — and the
 * number on the Apply button — describe what Apply will actually do.
 */

const BUNDLE = { version: 2, library: [{ name: "One Piece", mal_id: 13 }] };

const CONFLICTS = [
  { name: "One Piece", mal_id: 13, volumes: 110, owned_volumes: 78 },
  { name: "Vagabond", mal_id: 656, volumes: 37, owned_volumes: 37 },
];

const MERGE_PREVIEW = {
  added: 3,
  skipped_conflict: 2,
  replaced: 0,
  skipped_invalid: 0,
  added_series: [],
  conflict_series: CONFLICTS,
};

const REPLACE_PREVIEW = {
  ...MERGE_PREVIEW,
  skipped_conflict: 0,
  replaced: 2,
};

let archive;

beforeAll(async () => {
  await loadLanguage("en");
});

beforeEach(() => {
  archive = {
    exportJson: vi.fn(),
    exportCsv: vi.fn(),
    isExporting: false,
    preview: vi.fn((_bundle, mode) =>
      Promise.resolve(mode === "replace" ? REPLACE_PREVIEW : MERGE_PREVIEW),
    ),
    isPreviewing: false,
    previewError: null,
    commit: vi.fn(() =>
      Promise.resolve({ added: 3, replaced: 2, skipped_conflict: 0 }),
    ),
    isCommitting: false,
    commitError: null,
    reset: vi.fn(),
  };
  useArchive.mockReturnValue(archive);
});

function renderSection() {
  return render(
    <MemoryRouter>
      <I18nProvider lang="en">
        <ArchiveSection />
      </I18nProvider>
    </MemoryRouter>,
  );
}

/** Open the modal and feed it a bundle; resolves once the preview shows. */
async function openWithBundle() {
  renderSection();
  fireEvent.click(screen.getByRole("button", { name: /choose a file/i }));
  const input = document.querySelector('input[type="file"]');
  const file = new File([JSON.stringify(BUNDLE)], "mangacollector.json", {
    type: "application/json",
  });
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByRole("radiogroup");
  await waitFor(() => expect(archive.preview).toHaveBeenCalledTimes(1));
}

describe("ArchiveSection import — conflict policy", () => {
  it("previews as a merge first and shows conflicts as skipped", async () => {
    await openWithBundle();
    expect(archive.preview).toHaveBeenCalledWith(BUNDLE, "merge");
    expect(screen.getByRole("radio", { name: /keep mine/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("Conflicts")).toBeInTheDocument();
    expect(screen.queryByText("To replace")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apply · +3 series" }),
    ).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("re-runs the dry run when switching to replace and warns", async () => {
    await openWithBundle();
    fireEvent.click(screen.getByRole("radio", { name: /take the file's/i }));
    await waitFor(() =>
      expect(archive.preview).toHaveBeenLastCalledWith(BUNDLE, "replace"),
    );
    expect(
      screen.getByRole("radio", { name: /take the file's/i }),
    ).toHaveAttribute("aria-checked", "true");
    expect(await screen.findByText("To replace")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "2 series will be rewritten from the file",
    );
    expect(screen.getByText(/will be replaced · 2/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apply · +3 / ↻2 series" }),
    ).toBeEnabled();
  });

  it("does not re-run the dry run for the policy already selected", async () => {
    await openWithBundle();
    fireEvent.click(screen.getByRole("radio", { name: /keep mine/i }));
    expect(archive.preview).toHaveBeenCalledTimes(1);
  });

  it("commits with the policy that was previewed", async () => {
    await openWithBundle();
    fireEvent.click(screen.getByRole("radio", { name: /take the file's/i }));
    const apply = await screen.findByRole("button", {
      name: "Apply · +3 / ↻2 series",
    });
    fireEvent.click(apply);
    await waitFor(() =>
      expect(archive.commit).toHaveBeenCalledWith(BUNDLE, "replace"),
    );
    expect(
      await screen.findByText(/3 series added, 2 restored from the file/),
    ).toBeInTheDocument();
  });

  it("lets replace unlock Apply when a merge would add nothing", async () => {
    archive.preview.mockImplementation((_b, mode) =>
      Promise.resolve(
        mode === "replace"
          ? { ...REPLACE_PREVIEW, added: 0 }
          : { ...MERGE_PREVIEW, added: 0 },
      ),
    );
    await openWithBundle();
    expect(
      screen.getByRole("button", { name: "Apply · +0 series" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/already exists in your library — nothing to add/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /take the file's/i }));
    expect(
      await screen.findByRole("button", { name: "Apply · +0 / ↻2 series" }),
    ).toBeEnabled();
  });
});
