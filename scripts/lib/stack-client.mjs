/*
 * 鍵 · Headless client for the local test stack.
 *
 * Logs a subject in through the app's REAL OAuth flow against the mock
 * OpenID Connect provider (see docs/test-stack.md), keeps the session
 * cookie, and exposes an `api()` that stamps the headers the server's
 * guards require (Origin for CSRF, X-Requested-With, X-Client-Id).
 * Shared by the seed and the verification scripts.
 *
 *   const c = await login("test-collector");
 *   const res = await c.api("GET", "/api/user/library");
 */

export const SERVER = process.env.SEED_SERVER ?? "http://localhost:3000";
export const ORIGIN = process.env.SEED_ORIGIN ?? "http://localhost:5173"; // must equal FRONTEND_URL

/** Minimal cookie jar — one host, the way a browser would keep it. */
class Jar {
  constructor() {
    this.map = new Map();
  }
  absorb(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() {
    return [...this.map].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export async function login(subject, { clientId = `script-${subject}`.slice(0, 64) } = {}) {
  const jar = new Jar();
  const go = async (url, init = {}) => {
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), cookie: jar.header() },
      redirect: "manual",
    });
    jar.absorb(res);
    return res;
  };

  // 1. /auth/oauth2 → 302 to the mock's /authorize (PKCE + nonce land in the session)
  const start = await go(`${SERVER}/auth/oauth2`);
  const authorize = start.headers.get("location");
  if (!authorize) throw new Error(`/auth/oauth2 → ${start.status} without Location`);
  // 2. the mock's interactive login form, posted back to the same URL
  const form = await fetch(authorize, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: subject }),
    redirect: "manual",
  });
  const back = form.headers.get("location");
  if (!back?.includes("/auth/oauth2/callback")) {
    throw new Error(`mock login did not redirect to the callback (status ${form.status})`);
  }
  // 3. the callback, hit on the server directly (the URL names the frontend origin)
  const cb = new URL(back);
  const done = await go(`${SERVER}${cb.pathname}${cb.search}`);
  if (done.status < 300 || done.status > 399) throw new Error(`callback → ${done.status}`);

  const api = async (method, path, body) => {
    const res = await go(`${SERVER}${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        "x-requested-with": "XMLHttpRequest",
        "x-client-id": clientId.replace(/[^A-Za-z0-9_-]/g, "-").padEnd(8, "0"),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return res;
  };
  const json = async (method, path, body) => {
    const res = await api(method, path, body);
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };

  const me = await json("GET", "/auth/user");
  return { subject, user: me, api, json };
}
