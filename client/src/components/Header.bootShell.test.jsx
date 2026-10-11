import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider, loadLanguage } from "@/i18n/index.jsx";
import { noteBootShell } from "@/lib/bootShell.js";

/*
 * 殻 · `index.html` paints the header's brand before any script runs,
 * and React swaps it for the real header when it mounts. The swap is
 * invisible only while the two are the same markup — this renders the
 * real header and holds the shell to it.
 */
vi.mock("@/hooks/useAuth.js", () => ({ useAuth: () => ({ isAuthenticated: false, status: { kind: "unauthenticated" } }) }));
vi.mock("@/hooks/useNavCounters.js", () => ({ useNavCounters: () => ({}) }));
vi.mock("./ProfileButton", () => ({ default: () => null }));
vi.mock("./InstallPrompt", () => ({ default: () => null }));

const html = fs.readFileSync(path.resolve(import.meta.dirname, "../../index.html"), "utf8");
const shellHtml = html.match(/<header data-boot-shell[\s\S]*?<\/header>/)?.[0];

// The sheen and the stamp are what the swap is allowed to change: the
// shell's seal is still, the real one gets its sheen when it mounts.
const MOTION = new Set(["gold-shimmer", "gold-shimmer-strong", "gold-shimmer-settle", "animate-stamp"]);

function normalise(element) {
  const clone = element.cloneNode(true);
  for (const node of [clone, ...clone.querySelectorAll("*")]) {
    const classes = [...node.classList].filter((c) => !MOTION.has(c)).sort();
    node.removeAttribute("class");
    if (classes.length) node.setAttribute("class", classes.join(" "));
    node.removeAttribute("style");
  }
  return clone.outerHTML.replace(/>\s+</g, "><").trim();
}

let Header;
beforeAll(async () => {
  await loadLanguage("en");
  ({ default: Header } = await import("./Header.jsx"));
});

function renderHeader() {
  return render(
    <MemoryRouter>
      <I18nProvider lang="en">
        <Header />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("the boot shell", () => {
  it("is in index.html, inside the element React mounts into", () => {
    expect(shellHtml).toBeTruthy();
    expect(html).toMatch(/<div id="root"><header data-boot-shell/);
  });

  it("draws the brand exactly as the header does", () => {
    const template = document.createElement("template");
    template.innerHTML = shellHtml;
    const shell = template.content.querySelector("header");

    const { container } = renderHeader();
    const header = container.querySelector("header");

    // The bar itself: what places it.
    const placement = ["sticky", "top-0", "z-40", "border-b"];
    for (const name of placement) {
      expect(shell.classList.contains(name), `shell header lacks ${name}`).toBe(true);
      expect(header.classList.contains(name), `header lacks ${name}`).toBe(true);
    }
    // The row and the brand inside it, element for element.
    expect(shell.firstElementChild.className).toBe(header.firstElementChild.className);
    expect(normalise(shell.querySelector("a"))).toBe(normalise(header.querySelector("a")));
  });

  it("keeps the seal still when the shell was on screen, and stamps it when not", async () => {
    const { container, unmount } = renderHeader();
    expect(container.querySelector(".hanko-seal").classList.contains("animate-stamp")).toBe(true);
    unmount();

    const root = document.createElement("div");
    root.innerHTML = shellHtml;
    noteBootShell(root);
    const again = renderHeader();
    expect(again.container.querySelector(".hanko-seal").classList.contains("animate-stamp")).toBe(false);
  });
});
