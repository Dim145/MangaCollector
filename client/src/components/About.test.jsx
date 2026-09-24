import { render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { I18nProvider, loadLanguage } from "@/i18n/index.jsx";

vi.mock("@/hooks/useAuth.js", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/hooks/useLibrary.js", () => ({
  useLibrary: vi.fn(),
}));

// `CoverImage` defers its `<img>` behind an IntersectionObserver jsdom
// does not have. The landing only needs it to be *there* with the right
// alt text, so a plain image stands in.
vi.mock("@/components/ui/CoverImage.jsx", () => ({
  default: ({ alt }) => <img alt={alt} data-testid="own-cover" />,
}));

const { useAuth } = await import("@/hooks/useAuth.js");
const { useLibrary } = await import("@/hooks/useLibrary.js");
const About = (await import("./About.jsx")).default;
const en = (await import("@/i18n/en.js")).default.about;

/*
 * The landing page is the one surface every visitor sees before trusting
 * the app with a shelf, and it used to lie in three places: fabricated
 * testimonials, MyAnimeList's top 8 dressed as a library and fetched
 * from a third party on every anonymous visit, and copyrighted covers
 * bundled as decoration. These tests pin the replacements.
 */

const SHELF = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  mal_id: 100 + i,
  name: `Series ${i + 1}`,
  image_url_jpg: `https://cdn.myanimelist.net/${i + 1}.jpg`,
  modified_on: `2026-09-0${i + 1}T00:00:00Z`,
}));

const STRANGER = {
  isAuthenticated: false,
  user: null,
  isLoading: false,
  status: { kind: "unauthenticated" },
};

function signedIn() {
  const user = { name: "D" };
  useAuth.mockReturnValue({
    isAuthenticated: true,
    user,
    isLoading: false,
    status: { kind: "authenticated", user },
  });
}

beforeAll(async () => {
  await loadLanguage("en");
});

beforeEach(() => {
  useAuth.mockReturnValue(STRANGER);
  useLibrary.mockReturnValue({ data: [], isEmpty: true, isInitialLoad: false });
  vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderLanding() {
  return render(
    <I18nProvider lang="en">
      <About />
    </I18nProvider>,
  );
}

describe("the landing page", () => {
  it("makes no request to anyone when a stranger looks at it", () => {
    renderLanding();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    // …and asks the library hook to stay quiet too.
    expect(useLibrary).toHaveBeenCalledWith({ enabled: false });
  });

  it("carries no testimonial, and shows the product instead", () => {
    renderLanding();
    for (const ghost of ["Marco D.", "Kenji T.", "Aiko R.", "Full-stack dev"]) {
      expect(screen.queryByText(new RegExp(ghost))).not.toBeInTheDocument();
    }
    // The four screenshots, each with a real description — meaningful
    // images, not decoration.
    const shots = screen
      .getAllByRole("img")
      .filter((img) => img.getAttribute("src")?.includes("assets/screens"));
    expect(shots.length).toBeGreaterThanOrEqual(4);
    for (const img of shots) {
      expect(img.getAttribute("alt")?.length).toBeGreaterThan(20);
      // Intrinsic size declared, so nothing shifts when the bytes land.
      expect(img).toHaveAttribute("width");
      expect(img).toHaveAttribute("height");
    }
    expect(screen.getByText(/what it is\./i)).toBeInTheDocument();
  });

  it("shows the visitor's own shelf once signed in with enough series", () => {
    signedIn();
    useLibrary.mockReturnValue({
      data: SHELF,
      isEmpty: false,
      isInitialLoad: false,
    });
    renderLanding();
    expect(useLibrary).toHaveBeenCalledWith({ enabled: true });
    const covers = screen.getAllByTestId("own-cover");
    expect(covers).toHaveLength(8);
    // Most recently touched first.
    expect(covers[0]).toHaveAttribute("alt", "Series 8");
    expect(screen.getByText(/your shelf · 8 series/i)).toBeInTheDocument();
    // …and the calls to action lead to the shelf, not to the login page.
    expect(
      screen.getAllByRole("link", { name: en.openDashboard }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("link", { name: en.getStarted }),
    ).not.toBeInTheDocument();
  });

  it("greets a returning collector with their covers before the session check has answered", () => {
    // The session is still unknown — but this device remembers a
    // signed-in profile, and its cache already holds that shelf.
    useAuth.mockReturnValue({ ...STRANGER, status: { kind: "checking" } });
    localStorage.setItem("mc:auth-user", JSON.stringify({ user: { id: 7 }, ts: 1 }));
    useLibrary.mockReturnValue({
      data: SHELF,
      isEmpty: false,
      isInitialLoad: false,
    });
    renderLanding();
    expect(screen.getAllByTestId("own-cover")).toHaveLength(8);
    // The call to action follows the session, which has not answered.
    expect(
      screen.getAllByRole("link", { name: en.getStarted }).length,
    ).toBeGreaterThan(0);
    expect(useLibrary).toHaveBeenCalledWith({ enabled: false });
  });

  it("draws nobody's shelf once the session has been answered with a 401", () => {
    // 鍵 · A revoked or expired session: the probe said no. Whatever
    // is still in the cache belongs to an account that is not here,
    // and the next person at this device must not be shown it.
    useAuth.mockReturnValue(STRANGER);
    useLibrary.mockReturnValue({
      data: SHELF,
      isEmpty: false,
      isInitialLoad: false,
    });
    renderLanding();
    expect(screen.queryAllByTestId("own-cover")).toHaveLength(0);
  });

  it("does not guess from a cache alone while the probe is out", () => {
    // Checking, but no remembered profile: nothing says this shelf is
    // the visitor's.
    useAuth.mockReturnValue({ ...STRANGER, status: { kind: "checking" } });
    useLibrary.mockReturnValue({
      data: SHELF,
      isEmpty: false,
      isInitialLoad: false,
    });
    renderLanding();
    expect(screen.queryAllByTestId("own-cover")).toHaveLength(0);
  });

  it("falls back to the screenshots when the shelf is too thin to mean anything", () => {
    signedIn();
    useLibrary.mockReturnValue({
      data: SHELF.slice(0, 2),
      isEmpty: false,
      isInitialLoad: false,
    });
    renderLanding();
    expect(screen.queryAllByTestId("own-cover")).toHaveLength(0);
    // Not the caption — the version pill also says "shelf".
    expect(screen.queryByText(/as on this device/i)).not.toBeInTheDocument();
  });

  it("keeps the three language bundles on the same set of landing keys", async () => {
    const bundles = await Promise.all(
      ["en", "fr", "es"].map(
        async (lang) => (await import(`@/i18n/${lang}.js`)).default.about,
      ),
    );
    const [enKeys, fr, es] = bundles.map((b) => Object.keys(b).sort());
    expect(fr).toEqual(enKeys);
    expect(es).toEqual(enKeys);
    for (const keys of [enKeys, fr, es]) {
      expect(keys.some((k) => /^t\d(Name|Role|Quote)$/.test(k))).toBe(false);
    }
  });
});
