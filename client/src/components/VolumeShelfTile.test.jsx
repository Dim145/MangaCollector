import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { I18nProvider, loadLanguage } from "@/i18n/index.jsx";
import VolumeShelfTile from "./VolumeShelfTile.jsx";

/*
 * The ×N seal tells a collector at a glance which tomes they hold
 * twice. It counts copies (1 + extras), shows only on a copy that is
 * actually on the shelf — owned and released — and swallows junk.
 */

beforeAll(async () => {
  await loadLanguage("en");
});

const tile = (props) =>
  render(
    <I18nProvider lang="en">
      <VolumeShelfTile volNum={4} owned {...props} />
    </I18nProvider>,
  );

describe("VolumeShelfTile doubles seal", () => {
  it("counts the copies, extras included", () => {
    tile({ extraCopies: 2 });
    const seal = screen.getByLabelText(/3 copies/i);
    expect(seal).toHaveTextContent("×3");
  });

  it("stays away from a single copy", () => {
    tile({ extraCopies: 0 });
    expect(screen.queryByText(/^×/)).not.toBeInTheDocument();
  });

  it("stays away from a tome that is not on the shelf", () => {
    tile({ owned: false, extraCopies: 2 });
    expect(screen.queryByText(/^×/)).not.toBeInTheDocument();
    const future = new Date(Date.now() + 30 * 86400000).toISOString();
    tile({ extraCopies: 2, releaseDate: future });
    expect(screen.queryByText(/^×/)).not.toBeInTheDocument();
  });

  it("ignores junk counts", () => {
    tile({ extraCopies: "lots" });
    expect(screen.queryByText(/^×/)).not.toBeInTheDocument();
    tile({ extraCopies: -3 });
    expect(screen.queryByText(/^×/)).not.toBeInTheDocument();
  });
});
