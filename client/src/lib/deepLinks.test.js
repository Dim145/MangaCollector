import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureDeepLinkIntentFromUrl,
  consumeShareIntent,
  consumeShortcutIntent,
  discardShareIntent,
  peekShareIntent,
} from "./deepLinks.js";

/*
 * The intent vault exists for two reasons the module header spells
 * out: surviving the OAuth bounce that eats the query string, and
 * clearing the URL so an untrusted share payload never leaves as a
 * Referer. Both get direct coverage here, along with the shortcut
 * whitelist that stops a crafted URL smuggling arbitrary strings into
 * the destination page's branch logic.
 */

/** Point jsdom's location at a URL without a real navigation. */
function atUrl(search) {
  window.history.replaceState(null, "", `/addmanga${search}`);
}

beforeEach(() => {
  atUrl("");
});

describe("captureDeepLinkIntentFromUrl", () => {
  it("returns false and touches nothing on a clean URL", () => {
    expect(captureDeepLinkIntentFromUrl()).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });

  describe("shortcuts", () => {
    it.each(["scan", "library"])("captures the %s shortcut", (shortcut) => {
      atUrl(`?shortcut=${shortcut}`);
      expect(captureDeepLinkIntentFromUrl()).toBe(true);
      expect(consumeShortcutIntent()).toBe(shortcut);
    });

    it.each(["profile", "../../etc", "<script>", "SCAN", ""])(
      "drops the unwhitelisted shortcut %p",
      (shortcut) => {
        atUrl(`?shortcut=${encodeURIComponent(shortcut)}`);
        captureDeepLinkIntentFromUrl();
        expect(consumeShortcutIntent()).toBeNull();
      },
    );

    it("strips an unwhitelisted shortcut from the URL anyway", () => {
      atUrl("?shortcut=evil");
      captureDeepLinkIntentFromUrl();
      expect(window.location.search).toBe("");
    });
  });

  describe("share target", () => {
    it("captures all three fields", () => {
      atUrl("?share_title=Berserk&share_text=look&share_url=https%3A%2F%2Fex.com");
      expect(captureDeepLinkIntentFromUrl()).toBe(true);
      expect(consumeShareIntent()).toEqual({
        title: "Berserk",
        text: "look",
        url: "https://ex.com",
      });
    });

    it.each([
      ["?share_title=Berserk", { title: "Berserk", text: null, url: null }],
      ["?share_text=hello", { title: null, text: "hello", url: null }],
      ["?share_url=https%3A%2F%2Fex.com", { title: null, text: null, url: "https://ex.com" }],
    ])("captures the partial payload %p, preserving null fields", (search, expected) => {
      atUrl(search);
      captureDeepLinkIntentFromUrl();
      expect(consumeShareIntent()).toEqual(expected);
    });

    it("captures a shortcut and a share in the same URL", () => {
      atUrl("?shortcut=scan&share_title=Berserk");
      expect(captureDeepLinkIntentFromUrl()).toBe(true);
      expect(consumeShortcutIntent()).toBe("scan");
      expect(consumeShareIntent()).toMatchObject({ title: "Berserk" });
    });
  });

  describe("URL hygiene", () => {
    it("strips every consumed param so they cannot leak as Referer", () => {
      atUrl("?shortcut=scan&share_title=Berserk&share_text=t&share_url=u");
      captureDeepLinkIntentFromUrl();
      expect(window.location.search).toBe("");
    });

    it("preserves unrelated query params", () => {
      atUrl("?share_title=Berserk&utm_source=twitter");
      captureDeepLinkIntentFromUrl();
      expect(window.location.search).toBe("?utm_source=twitter");
    });

    it("keeps the path intact", () => {
      atUrl("?share_title=Berserk");
      captureDeepLinkIntentFromUrl();
      expect(window.location.pathname).toBe("/addmanga");
    });

    it("does not push a history entry", () => {
      const spy = vi.spyOn(window.history, "pushState");
      atUrl("?share_title=Berserk");
      captureDeepLinkIntentFromUrl();
      expect(spy).not.toHaveBeenCalled();
    });

    it("is a quiet no-op when called twice", () => {
      atUrl("?share_title=Berserk");
      expect(captureDeepLinkIntentFromUrl()).toBe(true);
      expect(captureDeepLinkIntentFromUrl()).toBe(false);
    });
  });

  it("does not throw when sessionStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    atUrl("?shortcut=scan&share_title=Berserk");
    expect(() => captureDeepLinkIntentFromUrl()).not.toThrow();
  });
});

describe("consumeShortcutIntent", () => {
  it("returns null when nothing was stashed", () => {
    expect(consumeShortcutIntent()).toBeNull();
  });

  it("clears the intent so a reload does not replay it", () => {
    atUrl("?shortcut=scan");
    captureDeepLinkIntentFromUrl();
    expect(consumeShortcutIntent()).toBe("scan");
    expect(consumeShortcutIntent()).toBeNull();
  });

  it("rejects a value tampered with directly in storage", () => {
    sessionStorage.setItem("mc:deeplink:shortcut", "evil");
    expect(consumeShortcutIntent()).toBeNull();
  });
});

describe("consumeShareIntent", () => {
  it("returns null when nothing was stashed", () => {
    expect(consumeShareIntent()).toBeNull();
  });

  it("clears the intent so a reload does not replay it", () => {
    atUrl("?share_title=Berserk");
    captureDeepLinkIntentFromUrl();
    expect(consumeShareIntent()).toMatchObject({ title: "Berserk" });
    expect(consumeShareIntent()).toBeNull();
  });

  it("clamps each field to 1024 characters", () => {
    sessionStorage.setItem(
      "mc:deeplink:share",
      JSON.stringify({ title: "A".repeat(5000), text: "B".repeat(5000), url: "C".repeat(5000) }),
    );
    const out = consumeShareIntent();
    expect(out.title).toHaveLength(1024);
    expect(out.text).toHaveLength(1024);
    expect(out.url).toHaveLength(1024);
  });

  it("nulls out non-string fields", () => {
    sessionStorage.setItem(
      "mc:deeplink:share",
      JSON.stringify({ title: 42, text: { a: 1 }, url: ["x"] }),
    );
    expect(consumeShareIntent()).toEqual({ title: null, text: null, url: null });
  });

  it.each(["not json", "null", '"a string"'])(
    "returns null for the malformed stash %p",
    (raw) => {
      sessionStorage.setItem("mc:deeplink:share", raw);
      expect(consumeShareIntent()).toBeNull();
    },
  );

  it("degrades a tampered array stash to an all-null intent", () => {
    // `typeof [] === "object"`, so an array slips past the shape guard
    // and comes back as {title: null, text: null, url: null} rather
    // than null. Unreachable through the normal flow — capture only
    // ever writes JSON.stringify({title, text, url}) — so this pins
    // the behaviour rather than arguing for a stricter guard.
    sessionStorage.setItem("mc:deeplink:share", "[]");
    expect(consumeShareIntent()).toEqual({ title: null, text: null, url: null });
  });
});

describe("peekShareIntent / discardShareIntent", () => {
  it("peek leaves the intent in place", () => {
    atUrl("?share_title=Berserk");
    captureDeepLinkIntentFromUrl();
    expect(peekShareIntent()).toMatchObject({ title: "Berserk" });
    expect(peekShareIntent()).toMatchObject({ title: "Berserk" });
    expect(consumeShareIntent()).toMatchObject({ title: "Berserk" });
  });

  it("peek returns null when nothing is stashed", () => {
    expect(peekShareIntent()).toBeNull();
  });

  it("discard drops the intent without consuming it through the normal flow", () => {
    atUrl("?share_title=Berserk");
    captureDeepLinkIntentFromUrl();
    discardShareIntent();
    expect(peekShareIntent()).toBeNull();
    expect(consumeShareIntent()).toBeNull();
  });

  it("discard is safe when nothing is stashed", () => {
    expect(() => discardShareIntent()).not.toThrow();
  });
});
