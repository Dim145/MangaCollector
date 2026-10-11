import { clearCachedUser } from "./auth.js";
import { clearAllUserData } from "@/lib/db.js";
import { purgePrivateCaches } from "@/lib/privateCaches.js";
import { getClientId } from "@/lib/clientId.js";

const location = typeof window !== "undefined" ? window.location : undefined;

/*
 * 通 · The app's HTTP client — `fetch` underneath, axios's shape on top.
 *
 * It was an axios instance, and axios was 13 kB gzipped in the entry
 * chunk, on the critical path of every page, for what the app asks of
 * it: five verbs, JSON or `FormData` bodies, query parameters, a timeout,
 * an abort signal, text or blob answers, and two interceptors. That much
 * is below, and it answers the way axios did, so the thirty-odd modules
 * that call it — and the tests that mock it — did not change:
 *
 *   - a response is `{ data, status, statusText, headers, config }`,
 *     `headers` a plain object with lower-case names;
 *   - `data` is parsed JSON when the body is JSON, the raw text when it
 *     is not (axios's silent parsing), a `Blob` for `responseType: "blob"`,
 *     and `transformResponse` replaces the parsing when it is given;
 *   - a status outside 2xx rejects with an error carrying `response`,
 *     `config` and axios's `code` (`ERR_BAD_REQUEST` / `ERR_BAD_RESPONSE`);
 *     no response at all is `ERR_NETWORK`, a timeout `ECONNABORTED`, the
 *     caller's own abort `ERR_CANCELED`;
 *   - request interceptors run newest first and response interceptors in
 *     order, each pair chained like axios chains them; `use` returns an id
 *     that `eject` takes.
 *
 * Cookies go with every request (`credentials: "include"`, axios's
 * `withCredentials`). Only this origin is ever called through it; the
 * third-party catalogues in `lib/isbn.js` use `fetch` directly.
 */
const BASE_URL = (location ? location.origin : undefined) || "http://localhost:5173";
const ACCEPT = "application/json, text/plain, */*";

class HttpError extends Error {
  constructor(message, { code, config, response, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = code === "ERR_CANCELED" ? "CanceledError" : "HttpError";
    this.code = code;
    this.config = config;
    this.response = response;
    // Kept for code written against axios that asks.
    this.isAxiosError = true;
  }
}

function interceptorStack() {
  const handlers = [];
  return {
    handlers,
    use(onFulfilled, onRejected) {
      handlers.push({ onFulfilled, onRejected });
      return handlers.length - 1;
    },
    eject(id) {
      if (handlers[id]) handlers[id] = null;
    },
  };
}

function buildUrl(config) {
  const url = /^[a-z][a-z\d+.-]*:\/\//i.test(config.url)
    ? new URL(config.url)
    : new URL(config.url, config.baseURL ?? BASE_URL);
  for (const [key, value] of Object.entries(config.params ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.append(key, String(value));
    }
  }
  return url.toString();
}

function isRawBody(data) {
  return (
    typeof data === "string" ||
    (typeof FormData !== "undefined" && data instanceof FormData) ||
    (typeof Blob !== "undefined" && data instanceof Blob) ||
    (typeof URLSearchParams !== "undefined" && data instanceof URLSearchParams) ||
    data instanceof ArrayBuffer ||
    ArrayBuffer.isView(data)
  );
}

function plainHeaders(headers) {
  const out = {};
  headers?.forEach?.((value, name) => {
    out[name.toLowerCase()] = value;
  });
  return out;
}

async function readBody(res, config) {
  if (config.responseType === "blob") return res.blob();
  if (config.responseType === "arraybuffer") return res.arrayBuffer();
  const text = await res.text();
  const transforms = config.transformResponse;
  if (Array.isArray(transforms) && transforms.length) {
    return transforms.reduce((body, fn) => fn(body), text);
  }
  if (config.responseType === "text" || text === "") return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Abort on the caller's signal or on the timeout, whichever comes first. */
function requestSignal(config) {
  const signals = [];
  if (config.signal) signals.push(config.signal);
  let timer = null;
  let timedOut = false;
  if (config.timeout > 0) {
    const controller = new AbortController();
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, config.timeout);
    signals.push(controller.signal);
  }
  let signal = signals[0];
  if (signals.length > 1) {
    if (typeof AbortSignal.any === "function") {
      signal = AbortSignal.any(signals);
    } else {
      const both = new AbortController();
      for (const s of signals) {
        if (s.aborted) both.abort();
        else s.addEventListener("abort", () => both.abort(), { once: true });
      }
      signal = both.signal;
    }
  }
  return { signal, timedOut: () => timedOut, done: () => timer != null && clearTimeout(timer) };
}

async function send(config) {
  const headers = { Accept: ACCEPT, ...(config.headers ?? {}) };
  let body;
  const data = config.data;
  if (data !== undefined && data !== null && !["GET", "HEAD"].includes(config.method)) {
    if (isRawBody(data)) {
      body = data;
      // The browser writes a multipart boundary only when it writes the
      // header itself.
      if (typeof FormData !== "undefined" && data instanceof FormData) {
        for (const name of Object.keys(headers)) {
          if (name.toLowerCase() === "content-type") delete headers[name];
        }
      }
    } else {
      body = JSON.stringify(data);
      if (!Object.keys(headers).some((n) => n.toLowerCase() === "content-type")) {
        headers["Content-Type"] = "application/json";
      }
    }
  }

  const { signal, timedOut, done } = requestSignal(config);
  let res;
  try {
    res = await fetch(buildUrl(config), {
      method: config.method,
      headers,
      body,
      credentials: "include",
      signal,
    });
  } catch (cause) {
    done();
    if (timedOut()) {
      throw new HttpError(`timeout of ${config.timeout}ms exceeded`, { code: "ECONNABORTED", config, cause });
    }
    if (config.signal?.aborted) {
      throw new HttpError("canceled", { code: "ERR_CANCELED", config, cause });
    }
    throw new HttpError("Network Error", { code: "ERR_NETWORK", config, cause });
  }

  let payload;
  try {
    payload = await readBody(res, config);
  } catch (cause) {
    done();
    if (timedOut()) {
      throw new HttpError(`timeout of ${config.timeout}ms exceeded`, { code: "ECONNABORTED", config, cause });
    }
    throw new HttpError("Network Error", { code: "ERR_NETWORK", config, cause });
  }
  done();

  const response = {
    data: payload,
    status: res.status,
    statusText: res.statusText,
    headers: plainHeaders(res.headers),
    config,
  };
  if (res.status < 200 || res.status >= 300) {
    throw new HttpError(`Request failed with status code ${res.status}`, {
      code: res.status >= 500 ? "ERR_BAD_RESPONSE" : "ERR_BAD_REQUEST",
      config,
      response,
    });
  }
  return response;
}

const interceptors = {
  request: interceptorStack(),
  response: interceptorStack(),
};

function request(input) {
  let config = {
    ...input,
    method: (input.method ?? "get").toUpperCase(),
    headers: { ...(input.headers ?? {}) },
  };
  // Request interceptors run newest first, as axios runs them.
  let chain = Promise.resolve(config);
  for (const handler of [...interceptors.request.handlers].reverse()) {
    if (!handler) continue;
    chain = chain.then(handler.onFulfilled, handler.onRejected);
  }
  let promise = chain.then((final) => {
    config = final;
    return send(final);
  });
  for (const handler of interceptors.response.handlers) {
    if (!handler) continue;
    promise = promise.then(handler.onFulfilled, handler.onRejected);
  }
  return promise;
}

const http = {
  defaults: { baseURL: BASE_URL },
  interceptors,
  request,
  get: (url, config = {}) => request({ ...config, url, method: "get" }),
  delete: (url, config = {}) => request({ ...config, url, method: "delete" }),
  head: (url, config = {}) => request({ ...config, url, method: "head" }),
  post: (url, data, config = {}) => request({ ...config, url, data, method: "post" }),
  put: (url, data, config = {}) => request({ ...config, url, data, method: "put" }),
  patch: (url, data, config = {}) => request({ ...config, url, data, method: "patch" }),
};

/**
 * 機 · Session-loss recovery interceptor.
 *
 * When the server returns 401 from an authenticated endpoint, the
 * session this client was using has been revoked, expired, or the
 * user's account was deleted. The handler:
 *
 *   1. Wipes the cached user blob in localStorage so the UI can't
 *      keep painting "logged-in" state from stale data.
 *   2. Purges Dexie + TanStack Query so private data of the now-
 *      revoked session can't bleed into a subsequent re-login on
 *      the same device.
 *   3. Notifies the rest of the SPA via a `mc:session-lost` custom
 *      event — slow consumers (analytics, sync runner) listen and
 *      tear themselves down.
 *   4. Hard-navigates to `/log-in?lost=1` so the JS modules reload
 *      with a fresh state. A React Router push would keep the
 *      module-level latch (`sessionLostHandled`) and cache around,
 *      opening the door to redirect loops.
 *
 * Suppressed for:
 *   - the OAuth flow endpoints (they handle their own 401)
 *   - public profile / health endpoints (they don't 401, but
 *     belt-and-braces)
 *   - any current path that's already public (no point bouncing
 *     the user off the landing or the public profile they're
 *     reading).
 *
 * 始末 · `sessionLostHandled` is a module-level latch that prevents
 * the same 401 burst from triggering N hard-reloads. It's reset by
 * `resetSessionLostLatch()` at the start of every fresh OAuth flow
 * — without that reset, a user who re-logs in WITHOUT a hard reload
 * (rare in practice, but possible) would have a future revocation
 * silently swallowed because the latch was sticky from the prior
 * session. Belt-and-braces: also bound the latch to a 30-second
 * window so a marathon SPA session can't carry a stale latch
 * indefinitely.
 */
let sessionLostHandled = false;
let sessionLostHandledAt = 0;
const SESSION_LOST_TTL_MS = 30_000;

/**
 * Allow-list of public routes that should NEVER trigger a redirect
 * to /log-in on a 401 — the user is already on a path that doesn't
 * require auth, so bouncing them is a worse UX than letting the
 * 401 propagate. Set membership is stricter than a regex and easier
 * to reason about as routes evolve.
 */
const PUBLIC_PATHS = new Set(["/", "/log-in", "/glossary"]);
function isPublicPath(pathname) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Public profile pages live under /u/<slug> — slug shape isn't
  // pinned here on purpose; anything under /u/ is by definition
  // un-authenticated readable.
  if (pathname.startsWith("/u/")) return true;
  return false;
}

/**
 * Reset the session-lost latch. Called at the start of a fresh OAuth
 * flow so a future revocation in the new session is detected and
 * handled instead of being silently swallowed.
 */
export function resetSessionLostLatch() {
  sessionLostHandled = false;
  sessionLostHandledAt = 0;
}

function isAuthRelevant401(error) {
  if (!error?.response || error.response.status !== 401) return false;
  const url = error.config?.url ?? "";
  if (url.includes("/auth/oauth2/")) return false;
  // /auth/user is the canonical "am I logged in?" probe — its 401 is
  // the answer to the question, not an unexpected revocation. Letting
  // it through here would race the dedicated handler in
  // `getAuthStatus()` and trigger a redirect on every cold load
  // following a session expiry.
  if (url.includes("/auth/user")) return false;
  if (url.includes("/api/public/")) return false;
  if (url.includes("/api/health")) return false;
  return true;
}

// 源 · Stamp every request with this tab's client id so the realtime
// broker can attribute the resulting SyncEvent to us and not echo it
// back to our own socket (see lib/clientId.js).
http.interceptors.request.use((config) => {
  config.headers["X-Client-Id"] = getClientId();
  return config;
});

http.interceptors.response.use(
  (res) => res,
  (error) => {
    // Auto-expire a stale latch so a long-lived SPA session that's
    // been through one 401 isn't permanently deaf to future ones.
    if (
      sessionLostHandled &&
      Date.now() - sessionLostHandledAt > SESSION_LOST_TTL_MS
    ) {
      sessionLostHandled = false;
      sessionLostHandledAt = 0;
    }
    if (sessionLostHandled) return Promise.reject(error);
    if (!isAuthRelevant401(error)) return Promise.reject(error);

    sessionLostHandled = true;
    sessionLostHandledAt = Date.now();

    // Drop the cached user immediately so anything reading it
    // synchronously (header avatar, ProtectedRoute) sees "logged out".
    try {
      clearCachedUser();
    } catch {
      /* ignore */
    }

    // Tear down both client-side caches that would otherwise carry
    // private data across a re-login on the same device:
    //   - TanStack Query: in-memory query cache (covers, library,
    //     stats…). Cleared via the `mc:session-lost` event so this
    //     module doesn't have to import the QueryClient.
    //   - Dexie: persistent IDB outbox + library mirror. Imported
    //     statically: `auth.js` already pulls the module into the entry,
    //     so the dynamic import that used to sit here bought nothing
    //     but a chunk of its own — one more request on every cold
    //     load, before the first paint.
    try {
      window.dispatchEvent(new CustomEvent("mc:session-lost"));
    } catch {
      /* dispatchEvent should never throw — defensive */
    }
    Promise.resolve()
      .then(() => clearAllUserData())
      .catch(() => {
        /* dexie unavailable in some test environments — ignore */
      });
    // Service Worker caches that hold the just-revoked user's private
    // responses — the same list `logout()` purges (`lib/privateCaches.js`).
    purgePrivateCaches();

    if (location && !isPublicPath(location.pathname)) {
      // Hard reload so the module-level latch resets and TanStack's
      // cache rebuilds from a clean slate. `?lost=1` is a hook for
      // the login page to surface a "you were signed out" hint.
      window.location.replace("/log-in?lost=1");
    }

    return Promise.reject(error);
  },
);

export default http;
