import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    defaults: { baseURL: "http://localhost:5173" },
  },
  resetSessionLostLatch: vi.fn(),
}));
vi.mock("@/lib/db.js", () => ({ clearAllUserData: vi.fn(() => Promise.resolve()) }));

const axiosMod = await import("./axios");
const axios = axiosMod.default;
const { clearAllUserData } = await import("@/lib/db.js");
const {
  checkAuthStatus,
  clearCachedUser,
  flushPendingLogout,
  getAuthProvider,
  getAuthStatus,
  getCachedUser,
  hasPendingLogout,
  logout,
  mergeCachedUser,
} = await import("./auth.js");

/*
 * The auth cache is what lets the SPA paint a logged-in shell while
 * offline. Two rules make it safe, and both are asserted below:
 *
 *   - a 401/403 wipes it (the session is gone, so the cached blob must
 *     not keep the UI painting authenticated state), whereas a network
 *     failure keeps it (offline is not logged out);
 *   - a queued logout beats a still-valid cookie, so a user who logged
 *     out while offline is never silently resurrected.
 */

const USER = { id: 1, name: "Dim", email: "d@example.com" };
const httpError = (status) => ({ response: { status } });
const netError = () => Object.assign(new Error("Network Error"), {});

beforeEach(() => {
  vi.clearAllMocks();
  console.warn = vi.fn();
  console.error = vi.fn();
});

describe("cached user", () => {
  it("reports nothing cached on a fresh install", () => {
    expect(getCachedUser()).toBeNull();
  });

  it("caches the user after a successful status call", async () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: USER });
    await getAuthStatus();
    expect(getCachedUser()).toEqual(USER);
  });

  it("clears on demand", async () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: USER });
    await getAuthStatus();
    clearCachedUser();
    expect(getCachedUser()).toBeNull();
  });

  it.each(["not json", "{}", "null", '{"user":null}'])(
    "returns null for the corrupt cache %p",
    (raw) => {
      localStorage.setItem("mc:auth-user", raw);
      expect(getCachedUser()).toBeNull();
    },
  );
});

describe("mergeCachedUser", () => {
  beforeEach(async () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: USER });
    await getAuthStatus();
  });

  it("patches a field without dropping the others", () => {
    mergeCachedUser({ name: "Dimitri" });
    expect(getCachedUser()).toEqual({ ...USER, name: "Dimitri" });
  });

  it("adds a new field", () => {
    mergeCachedUser({ slug: "dim" });
    expect(getCachedUser()).toMatchObject({ slug: "dim", id: 1 });
  });

  it.each([[null], [undefined], ["string"], [42]])(
    "ignores the non-object patch %p",
    (patch) => {
      mergeCachedUser(patch);
      expect(getCachedUser()).toEqual(USER);
    },
  );

  it("does nothing when there is no cached user", () => {
    clearCachedUser();
    mergeCachedUser({ name: "Nobody" });
    expect(getCachedUser()).toBeNull();
  });
});

describe("getAuthStatus", () => {
  it("returns authenticated on a 200", async () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: USER });
    await expect(getAuthStatus()).resolves.toEqual({
      kind: "authenticated",
      user: USER,
    });
  });

  it("returns unauthenticated on a 200 with no body", async () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: null });
    await expect(getAuthStatus()).resolves.toEqual({ kind: "unauthenticated" });
  });

  it.each([401, 403])("returns unauthenticated on a %i", async (status) => {
    axios.get.mockResolvedValueOnce({ status: 200, data: USER });
    await getAuthStatus();
    axios.get.mockRejectedValueOnce(httpError(status));
    await expect(getAuthStatus()).resolves.toEqual({ kind: "unauthenticated" });
  });

  it.each([401, 403])("wipes the cache on a %i", async (status) => {
    axios.get.mockResolvedValueOnce({ status: 200, data: USER });
    await getAuthStatus();
    axios.get.mockRejectedValueOnce(httpError(status));
    await getAuthStatus();
    expect(getCachedUser()).toBeNull();
  });

  it("falls back to the cached user when the network is down", async () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: USER });
    await getAuthStatus();
    axios.get.mockRejectedValueOnce(netError());
    await expect(getAuthStatus()).resolves.toEqual({ kind: "cached", user: USER });
  });

  it("keeps the cache on a network failure — offline is not logged out", async () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: USER });
    await getAuthStatus();
    axios.get.mockRejectedValueOnce(netError());
    await getAuthStatus();
    expect(getCachedUser()).toEqual(USER);
  });

  it("returns unknown when the network is down and nothing is cached", async () => {
    axios.get.mockRejectedValueOnce(netError());
    await expect(getAuthStatus()).resolves.toEqual({ kind: "unknown" });
  });

  it("returns unknown on a 500 with no cache", async () => {
    axios.get.mockRejectedValueOnce(httpError(500));
    await expect(getAuthStatus()).resolves.toEqual({ kind: "unknown" });
  });
});

describe("pending logout", () => {
  it("is not pending by default", () => {
    expect(hasPendingLogout()).toBe(false);
  });

  it("is queued when the server is unreachable at logout", async () => {
    axios.post.mockRejectedValueOnce(netError());
    await logout();
    expect(hasPendingLogout()).toBe(true);
  });

  it("is not queued when the logout call succeeds", async () => {
    axios.post.mockResolvedValueOnce({ status: 200 });
    await logout();
    expect(hasPendingLogout()).toBe(false);
  });

  it("beats a still-valid cookie", async () => {
    // The security-relevant rule: a user who logged out while offline
    // must not be resurrected by a stale session cookie.
    axios.post.mockRejectedValueOnce(netError());
    await logout();
    axios.get.mockResolvedValue({ status: 200, data: USER });
    await expect(getAuthStatus()).resolves.toEqual({ kind: "unauthenticated" });
  });

  it("does not even call /auth/user while a logout is pending", async () => {
    axios.post.mockRejectedValueOnce(netError());
    await logout();
    vi.clearAllMocks();
    await getAuthStatus();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("flushes successfully once the server is reachable again", async () => {
    axios.post.mockRejectedValueOnce(netError());
    await logout();
    axios.post.mockResolvedValueOnce({ status: 200 });
    await expect(flushPendingLogout()).resolves.toBe(true);
    expect(hasPendingLogout()).toBe(false);
  });

  it("keeps the queue when the flush fails again", async () => {
    axios.post.mockRejectedValueOnce(netError());
    await logout();
    axios.post.mockRejectedValueOnce(netError());
    await expect(flushPendingLogout()).resolves.toBe(false);
    expect(hasPendingLogout()).toBe(true);
  });

  it("is a no-op when nothing is queued", async () => {
    await expect(flushPendingLogout()).resolves.toBe(false);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe("logout", () => {
  it("wipes the cached user before anything else can fail", async () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: USER });
    await getAuthStatus();
    axios.post.mockRejectedValueOnce(netError());
    await logout();
    expect(getCachedUser()).toBeNull();
  });

  it("purges the local database even when the server call fails", async () => {
    axios.post.mockRejectedValueOnce(netError());
    await logout();
    expect(clearAllUserData).toHaveBeenCalledTimes(1);
  });

  it("posts to the logout endpoint", async () => {
    axios.post.mockResolvedValueOnce({ status: 200 });
    await logout();
    expect(axios.post).toHaveBeenCalledWith("/auth/oauth2/logout", null, {
      timeout: 5000,
    });
  });

  it("never rejects, even when the server is unreachable", async () => {
    axios.post.mockRejectedValueOnce(netError());
    await expect(logout()).resolves.toBeUndefined();
  });
});

describe("checkAuthStatus", () => {
  it("returns the user when authenticated", async () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: USER });
    await expect(checkAuthStatus()).resolves.toEqual(USER);
  });

  it("returns the cached user when offline", async () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: USER });
    await getAuthStatus();
    axios.get.mockRejectedValueOnce(netError());
    await expect(checkAuthStatus()).resolves.toEqual(USER);
  });

  it.each([["unauthenticated", httpError(401)], ["unknown", netError()]])(
    "returns null for %s",
    async (_kind, err) => {
      axios.get.mockRejectedValueOnce(err);
      await expect(checkAuthStatus()).resolves.toBeNull();
    },
  );
});

describe("getAuthProvider", () => {
  it("returns the provider payload", async () => {
    axios.get.mockResolvedValueOnce({ data: { authName: "Google", authIcon: "g.svg" } });
    await expect(getAuthProvider()).resolves.toEqual({
      authName: "Google",
      authIcon: "g.svg",
    });
  });

  it("degrades to empty strings rather than throwing", async () => {
    // The login page renders this unconditionally; a throw here would
    // blank the only screen an unauthenticated user can reach.
    axios.get.mockRejectedValueOnce(netError());
    await expect(getAuthProvider()).resolves.toEqual({ authName: "", authIcon: "" });
  });
});
