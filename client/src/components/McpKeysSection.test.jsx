import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, loadLanguage, loadNamespaces } from "@/i18n/index.jsx";
import { PAGE_NAMESPACES } from "@/i18n/split.js";

vi.mock("@/hooks/useMcpKeys.js", () => ({
  useMcpKeys: vi.fn(),
  useMcpAudit: vi.fn(() => ({ data: [], isLoading: false })),
}));

const { useMcpKeys } = await import("@/hooks/useMcpKeys.js");
const McpKeysSection = (await import("./McpKeysSection.jsx")).default;

/*
 * Two properties of this panel are worth pinning, because getting
 * either wrong is silent and costly:
 *
 *   ① The mint dialog opens on the READ-ONLY preset. A key that can
 *      write when it only ever needed to read is the mistake people
 *      make once and regret later, and the default is the whole
 *      defence — nothing downstream re-asks the question.
 *
 *   ② The secret is shown once and lives only in component state. If
 *      it ever came back from a re-render of the list, the "copy it
 *      now" warning would be a lie and the value would outlive the
 *      dialog.
 */

const ALL_SCOPES = [
  "library:read",
  "library:write",
  "library:delete",
  "volumes:write",
  "loans:read",
];
const READ_ONLY = ["library:read", "loans:read"];

let hook;

beforeAll(async () => {
  await loadLanguage("en");
  // The page this component lives on brings its text (`i18n/split.js`).
  await loadNamespaces(PAGE_NAMESPACES.SettingsPage);
});

beforeEach(() => {
  hook = {
    keys: [],
    isLoading: false,
    isError: false,
    enabled: true,
    allScopes: ALL_SCOPES,
    readOnlyScopes: READ_ONLY,
    catalogueReady: true,
    mint: vi.fn(async () => ({
      id: "k1",
      prefix: "mcp_abc123",
      label: "Laptop",
      scopes: READ_ONLY,
      secret: "mcp_abc123_not-a-real-secret",
    })),
    isMinting: false,
    revoke: vi.fn(async () => {}),
    isRevoking: false,
  };
  useMcpKeys.mockReturnValue(hook);
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(async () => {}) },
  });
});

function renderPanel() {
  return render(
    <I18nProvider lang="en">
      <McpKeysSection />
    </I18nProvider>,
  );
}

describe("McpKeysSection", () => {
  it("opens the mint dialog on the read-only preset", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /new key/i }));

    // Every read-only scope checked, and nothing that writes.
    for (const scope of READ_ONLY) {
      expect(screen.getByRole("checkbox", { name: scope })).toBeChecked();
    }
    for (const scope of ["library:write", "library:delete", "volumes:write"]) {
      expect(screen.getByRole("checkbox", { name: scope })).not.toBeChecked();
    }
  });

  it("mints with exactly the scopes that are ticked", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /new key/i }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Laptop" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "volumes:write" }));
    fireEvent.click(screen.getByRole("button", { name: /mint the key/i }));

    await waitFor(() => expect(hook.mint).toHaveBeenCalledTimes(1));
    const { label, scopes } = hook.mint.mock.calls[0][0];
    expect(label).toBe("Laptop");
    expect([...scopes].sort()).toEqual(
      [...READ_ONLY, "volumes:write"].sort(),
    );
  });

  it("will not mint without a label or without a scope", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /new key/i }));
    const submit = screen.getByRole("button", { name: /mint the key/i });

    // No label yet.
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Laptop" },
    });
    expect(submit).toBeEnabled();

    // Untick everything the preset gave us.
    for (const scope of READ_ONLY) {
      fireEvent.click(screen.getByRole("checkbox", { name: scope }));
    }
    expect(submit).toBeDisabled();
  });

  it("shows the secret once, with a ready-made command, then drops it", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /new key/i }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Laptop" },
    });
    fireEvent.click(screen.getByRole("button", { name: /mint the key/i }));

    await screen.findByText(/only time the key is shown/i);
    expect(screen.getByText("mcp_abc123_not-a-real-secret")).toBeInTheDocument();
    // The command carries the key, so the user never assembles a header
    // by hand — which is how one ends up in a committed config file.
    expect(
      screen.getByText(/claude mcp add .*Bearer mcp_abc123_not-a-real-secret/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /copied it/i }));
    await waitFor(() =>
      expect(screen.queryByText("mcp_abc123_not-a-real-secret")).not.toBeInTheDocument(),
    );
  });

  it("says so when the operator has not switched the endpoint on", () => {
    useMcpKeys.mockReturnValue({ ...hook, enabled: false });
    renderPanel();
    expect(screen.getByText(/switched off on this instance/i)).toBeInTheDocument();
  });

  it("asks before revoking, and revokes by id", async () => {
    useMcpKeys.mockReturnValue({
      ...hook,
      keys: [
        {
          id: "k1",
          prefix: "mcp_abc123",
          label: "Laptop",
          scopes: READ_ONLY,
          created_at: "2026-09-01T10:00:00Z",
          last_used_at: null,
          expired: false,
        },
      ],
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }));
    expect(hook.revoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /revoke for good/i }));
    await waitFor(() => expect(hook.revoke).toHaveBeenCalledWith("k1"));
  });
});
