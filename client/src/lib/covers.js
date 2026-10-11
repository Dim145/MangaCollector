/**
 * 影 · Where a cover is fetched from.
 *
 * By default the browser asks MangaDex and MyAnimeList directly, which
 * means opening a library hands both CDNs the reader's address, once
 * per cover — 113 requests on the seeded library. The `Referer` is
 * already withheld; the request itself cannot be.
 *
 * When the operator sets `PROXY_COVERS=true` the server relays them
 * instead (`GET /api/user/cover`), and the CDNs see the server rather
 * than the reader. It is off by default because it moves those
 * megabytes onto the operator's connection, which is their decision to
 * make, not ours.
 *
 * Two conditions, both required: the operator turned it on, and this
 * reader has a session — the relay is authenticated, so rewriting for
 * an anonymous visitor on the landing page would buy a 401 per cover.
 * And `CoverImage` falls back to the original URL if a relayed cover
 * fails, so a misconfigured or overloaded relay costs a retry, never a
 * missing cover.
 */

/*
 * Both halves are remembered on the device, because both are learnt
 * too late to be useful otherwise: the operator's setting comes from
 * `/api/public-config`, a round trip, and the session from
 * `/auth/user`. The covers of the first screen are requested before
 * either answers, and nothing re-renders them afterwards — so read
 * from memory, the relay would never engage on the screen that has the
 * most covers on it. Remembered, it engages from the second visit on.
 *
 * Being wrong is cheap in both directions: a stale "yes" costs one
 * refused request per cover, after which `CoverImage` retries the
 * upstream address, and the next boot corrects the flag.
 */
const OFFERED_KEY = "mc:covers:relay";
const SESSION_KEY = "mc:covers:session";

function recall(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function keep(key, on) {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* private mode — the relay simply waits for the live answer */
  }
}

let offered = recall(OFFERED_KEY);
let signedIn = recall(SESSION_KEY);
let enabled = offered && signedIn;

function recompute() {
  enabled = offered && signedIn;
}

/** What the operator's `/api/public-config` said, at boot. */
export function rememberCoverProxySetting(on) {
  offered = Boolean(on);
  keep(OFFERED_KEY, offered);
  recompute();
}

/** Whether this reader has a session. The relay answers nobody else. */
export function setCoverProxySession(on) {
  signedIn = Boolean(on);
  keep(SESSION_KEY, signedIn);
  recompute();
}

/** Test seam: force the answer, both halves at once. */
export function setCoverProxy(on) {
  offered = Boolean(on);
  signedIn = Boolean(on);
  keep(OFFERED_KEY, offered);
  keep(SESSION_KEY, signedIn);
  recompute();
}

export function coverProxyEnabled() {
  return enabled;
}

/**
 * The URL to actually request for `url`.
 *
 * Left alone: anything that is not an absolute `http(s)` address (our
 * own `/api/...` poster paths, `data:` and `blob:` previews), and
 * anything already on this origin.
 */
/**
 * 門 · The two hosts the relay fetches from, and no others — the same
 * pair the server rebuilds its request on (`handlers/cover.rs`). Any
 * other address would be refused there anyway: sending it costs a 400
 * and a second request for every such cover, so it is not sent.
 */
const RELAYED_HOSTS = new Set(["cdn.myanimelist.net", "uploads.mangadex.org"]);

export function coverSrc(url) {
  if (!enabled || typeof url !== "string" || !url) return url;
  if (!/^https:\/\//i.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (!RELAYED_HOSTS.has(parsed.hostname)) return url;
    return `/api/user/cover?src=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return url;
  }
}

/** Is `src` one of ours, pointing back at the relay? */
export function isProxiedCover(src) {
  return typeof src === "string" && src.startsWith("/api/user/cover?src=");
}

/** The upstream address a relayed URL stands for, or `null`. */
export function originalCoverSrc(src) {
  if (!isProxiedCover(src)) return null;
  try {
    const value = new URLSearchParams(src.split("?")[1]).get("src");
    return value || null;
  } catch {
    return null;
  }
}

/*
 * 寸 · The sizes a cover host serves, as `srcset` candidates.
 *
 * Both CDNs keep more than one rendition of every cover, and the shelf
 * used to ask for the largest one everywhere — for a 28-pixel thumbnail
 * as for the series page. Measured on real covers:
 *
 *   MangaDex  `….512.jpg`  512×728  103–213 kB   `….256.jpg`  256×364  32–63 kB
 *   MAL       `…l.jpg`     422×600  156–190 kB   `…l.webp`    same size  38–49 kB
 *                                                `….webp`     225×320  14–20 kB
 *
 * MyAnimeList serves every cover as WebP too, at a quarter of the JPEG's
 * weight for the same pixels, and every browser this app supports reads
 * WebP — so its candidates are the two WebP renditions. The widths are
 * nominal (MAL's large rendition is 380–422 wide): the browser only uses
 * them to choose.
 *
 * Anything else — a poster on our own origin, a Google Books thumbnail,
 * an address pasted by hand — has no known renditions: `null`.
 */
const MANGADEX_COVER =
  /^https:\/\/uploads\.mangadex\.org\/covers\/([0-9a-f-]{36})\/([0-9a-f-]{36}\.(?:jpe?g|png|gif|webp))(?:\.(?:256|512)\.jpg)?$/i;
const MAL_COVER =
  /^https:\/\/cdn\.myanimelist\.net\/images\/(manga|anime)\/(\d{1,6})\/(\d{1,12})[lt]?\.(?:jpe?g|webp)$/i;

export function coverCandidates(url) {
  if (typeof url !== "string" || !url) return null;
  const md = MANGADEX_COVER.exec(url);
  if (md) {
    const base = `https://uploads.mangadex.org/covers/${md[1].toLowerCase()}/${md[2]}`;
    return [
      { url: `${base}.256.jpg`, width: 256 },
      { url: `${base}.512.jpg`, width: 512 },
    ];
  }
  const mal = MAL_COVER.exec(url);
  if (mal) {
    const base = `https://cdn.myanimelist.net/images/${mal[1].toLowerCase()}/${mal[2]}/${mal[3]}`;
    return [
      { url: `${base}.webp`, width: 225 },
      { url: `${base}l.webp`, width: 420 },
    ];
  }
  return null;
}

/**
 * `{ src, srcSet }` for an `<img>` showing `url`.
 *
 * `relay` applies the operator's cover relay to every candidate (the
 * server rebuilds each rendition from its parsed parts, see
 * `handlers/cover.rs`); `false` asks the CDN directly, which is the
 * first fallback when the relay fails. `src` is the largest candidate,
 * so a browser that ignored `srcset` would show what it always did.
 */
export function coverSources(url, { relay = true } = {}) {
  const wrap = relay ? coverSrc : (u) => u;
  const candidates = coverCandidates(url);
  if (!candidates) return { src: wrap(url), srcSet: undefined };
  return {
    src: wrap(candidates[candidates.length - 1].url),
    srcSet: candidates.map((c) => `${wrap(c.url)} ${c.width}w`).join(", "),
  };
}
