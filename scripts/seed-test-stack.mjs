#!/usr/bin/env node
/*
 * 種 · Seed the local test stack with a real-looking library.
 *
 *   node scripts/seed-test-stack.mjs            # ~35 series, a few minutes
 *   node scripts/seed-test-stack.mjs --big      # + MangaDex's top 100 (crosses the
 *                                               #   Dashboard's 100-series
 *                                               #   virtualization threshold)
 *   node scripts/seed-test-stack.mjs --big --only-big   # skip the core set
 *
 * Requires: docker-compose.test-stack.yml up, the server running with
 * server/test-stack.env, and network access to api.jikan.moe.
 *
 * How it authenticates — the app's own OAuth flow, end to end, against
 * the mock provider. No real credentials exist anywhere in this path:
 *   1. GET  /auth/oauth2           → 302 to the mock's /authorize (the
 *                                    server stores PKCE + nonce in a
 *                                    fresh session cookie)
 *   2. POST /authorize?…  username → the mock's login form; it answers
 *                                    302 to our callback with a code
 *   3. GET  /auth/oauth2/callback  → the server exchanges the code,
 *                                    verifies the id token, upgrades the
 *                                    session cookie to authenticated
 * From then on every request carries that cookie plus the Origin the
 * CSRF guard requires. Metadata for the core set comes from Jikan
 * (MyAnimeList) by id, paced under its public rate limit; `--big` adds
 * MangaDex's 100 most-followed series through the app's own MangaDex
 * add path — the same fallback source the Add page uses when MAL lacks
 * a series, so the result is the mixed library real users end up with.
 *
 * Jikan quirk, learnt the hard way: its edge answers 504 to any request
 * that advertises compressed encodings (`accept-encoding: gzip, …`),
 * which is what `fetch` sends by default. Requests go through
 * `node:https` with minimal headers instead — that path is 200 every
 * time while the same URL through `fetch` is 504 every time.
 */
import https from "node:https";
import { assertLocalTarget } from "./lib/stack-client.mjs";

assertLocalTarget();

const SERVER = process.env.SEED_SERVER ?? "http://localhost:3000";
const ORIGIN = process.env.SEED_ORIGIN ?? "http://localhost:5173"; // must equal FRONTEND_URL
const USERNAME = process.env.SEED_USER ?? "test-collector";
const BIG = process.argv.includes("--big");
// `--only-big` skips the core set — handy when it is already seeded and
// MAL is slow, so the run goes straight to the MangaDex top list.
const ONLY_BIG = BIG && process.argv.includes("--only-big");

// Core set: MAL manga ids. Direct `/manga/{id}` lookups are the
// reliable Jikan path; the `?q=` search endpoint 504s under load. Any
// id that resolves to a real series is fine test data — the mix of
// volume counts and statuses is what matters, not the exact titles.
const CORE = [
  [13, "One Piece"], // ongoing (`volumes: null`), pinned to 110 below
  [2, "Berserk"],
  [1, "Monster"],
  [3, "20th Century Boys"],
  [656, "Vagabond"],
  [11, "Naruto"],
  [12, "Bleach"],
  [51, "Slam Dunk"],
  [42, "Dragon Ball"],
  [21, "Death Note"],
  [25, "Fullmetal Alchemist"],
  [26, "Hunter x Hunter"],
  [642, "Vinland Saga"],
  [4632, "Oyasumi Punpun"],
  [23390, "Shingeki no Kyojin"],
  [33327, "Tokyo Ghoul"],
  [1354, "Gintama"],
  [598, "Fairy Tail"],
  [16765, "Kingdom"],
  [113138, "Jujutsu Kaisen"],
  [116778, "Chainsaw Man"],
  [119161, "Spy x Family"],
  [104, "Yotsuba to!"],
  [418, "Mushishi"],
  [1706, "Pluto"],
  [44347, "One Punch-Man"],
  [74697, "Boku no Hero Academia"],
  [96792, "Kimetsu no Yaiba"],
  [100448, "Dr. Stone"],
  [91941, "Yakusoku no Neverland"],
  [4, "Yokohama Kaidashi Kikou"],
  [7, "Hajime no Ippo"],
];
// Big set: MangaDex's 100 most-followed series in one call, added
// through the app's MangaDex path. Ongoing series have no `lastVolume`
// there; the Add page asks the user for a count in that case, and the
// seed assumes a plausible one the same way.
const MANGADEX_TOP = 100;
const MANGADEX_DEFAULT_VOLUMES = 12;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal cookie jar: enough for one host, the way a browser would keep it. */
class Jar {
  constructor() {
    this.map = new Map();
  }
  absorb(res) {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const c of raw) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0)
        this.map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() {
    return [...this.map].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}
const jar = new Jar();

async function go(url, init = {}) {
  const headers = { ...(init.headers ?? {}), cookie: jar.header() };
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  jar.absorb(res);
  return res;
}

async function login() {
  const start = await go(`${SERVER}/auth/oauth2`);
  if (start.status < 300 || start.status > 399)
    throw new Error(`/auth/oauth2 → ${start.status}`);
  const authorize = start.headers.get("location");
  if (!authorize) throw new Error("no Location from /auth/oauth2");

  // The mock's interactive login: POST the form back to the same URL.
  const form = new URLSearchParams({ username: USERNAME });
  const login = await fetch(authorize, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    redirect: "manual",
  });
  const back = login.headers.get("location");
  if (!back || !back.includes("/auth/oauth2/callback")) {
    throw new Error(
      `mock login did not redirect to the callback (status ${login.status})`,
    );
  }
  // The callback URL points at the frontend origin; hit the server directly.
  const cb = new URL(back);
  const done = await go(`${SERVER}${cb.pathname}${cb.search}`);
  if (done.status < 300 || done.status > 399)
    throw new Error(`callback → ${done.status}`);

  const me = await api("GET", "/auth/user");
  if (me.status !== 200)
    throw new Error(`/auth/user → ${me.status} after login`);
  const user = await me.json();
  console.log(`✓ logged in as ${user.email ?? user.name ?? user.id}`);
  return user;
}

async function api(method, path, body) {
  const res = await go(`${SERVER}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      "x-requested-with": "XMLHttpRequest",
      "x-client-id": "seed-script-000000",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

let lastJikan = 0;
function httpsJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "user-agent": "mangacollector-seed/1.0",
            accept: "application/json",
          },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode, body }));
        },
      )
      .on("error", reject);
  });
}
async function jikan(path) {
  // Public Jikan: 3 req/s and 60 req/min. 1.2 s spacing sits under both.
  const wait = lastJikan + 1200 - Date.now();
  if (wait > 0) await sleep(wait);
  lastJikan = Date.now();
  let last = 0;
  // Three attempts (2 s, 4 s, 6 s backoff): tolerant of a blip, quick
  // to hand a cold id over to the MangaDex fallback when MAL is slow.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { status, body } = await httpsJson(`https://api.jikan.moe/v4${path}`);
    last = status;
    // 429 = our pacing slipped; 5xx = Jikan's upstream is struggling.
    if (status === 429 || status >= 500) {
      await sleep(2500 * (attempt + 1));
      continue;
    }
    if (status !== 200) throw new Error(`jikan ${path} → ${status}`);
    return JSON.parse(body);
  }
  throw new Error(`jikan ${path}: gave up after 3 attempts (last ${last})`);
}

function normalise(m) {
  if (!m?.mal_id) return null;
  return {
    mal_id: m.mal_id,
    name: m.title_english || m.title,
    volumes: m.volumes ?? 0,
    image_url_jpg:
      m.images?.jpg?.large_image_url ?? m.images?.jpg?.image_url ?? null,
    genres: [
      ...(m.genres ?? []),
      ...(m.themes ?? []),
      ...(m.demographics ?? []),
    ]
      .map((g) => g.name)
      .filter(Boolean),
    status: m.status,
  };
}

async function lookupById(id) {
  const { data } = await jikan(`/manga/${id}`);
  return normalise(data);
}

function normaliseMangadex(m) {
  const a = m.attributes;
  const title =
    a.title?.en ??
    a.title?.["ja-ro"] ??
    Object.values(a.title ?? {})[0] ??
    m.id;
  const cover = m.relationships?.find((r) => r.type === "cover_art")?.attributes
    ?.fileName;
  const last = parseInt(a.lastVolume, 10);
  return {
    mangadex_id: m.id,
    name: title,
    volumes:
      Number.isFinite(last) && last > 0 ? last : MANGADEX_DEFAULT_VOLUMES,
    image_url_jpg: cover
      ? `https://uploads.mangadex.org/covers/${m.id}/${cover}.512.jpg`
      : null,
    genres: (a.tags ?? [])
      .map((t) => t.attributes?.name?.en)
      .filter(Boolean)
      .slice(0, 8),
  };
}

// MangaDex rates several classics `erotica` for violence or nudity
// (Berserk among them); excluding that rating silently swaps them for
// unrelated hits. `pornographic` stays out.
const MANGADEX_RATINGS = ["safe", "suggestive", "erotica"];

const fold = (t) =>
  t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

async function mangadexByTitle(title) {
  const q = new URLSearchParams({
    title,
    limit: "5",
    "order[relevance]": "desc",
  });
  for (const r of MANGADEX_RATINGS) q.append("contentRating[]", r);
  q.append("includes[]", "cover_art");
  const res = await fetch(`https://api.mangadex.org/manga?${q}`);
  if (!res.ok) throw new Error(`mangadex search → ${res.status}`);
  const { data } = await res.json();
  const want = fold(title);
  // Relevance ordering is loose: prefer the hit whose title (any
  // language) IS what we asked for; only then accept one that contains
  // it — and never a stranger.
  const hits = (data ?? []).map((m) => ({
    m,
    names: [m.attributes?.title ?? {}, ...(m.attributes?.altTitles ?? [])]
      .flatMap((o) => Object.values(o))
      .map(fold),
  }));
  const exact = hits.find((h) => h.names.includes(want));
  if (exact) return normaliseMangadex(exact.m);
  const loose = hits.find((h) => h.names.some((n) => n.includes(want)));
  if (loose) return normaliseMangadex(loose.m);
  return null;
}

async function mangadexTop(limit) {
  const q = new URLSearchParams({
    limit: String(limit),
    "order[followedCount]": "desc",
    hasAvailableChapters: "true",
  });
  for (const r of MANGADEX_RATINGS) q.append("contentRating[]", r);
  q.append("includes[]", "cover_art");
  const res = await fetch(`https://api.mangadex.org/manga?${q}`);
  if (!res.ok) throw new Error(`mangadex top → ${res.status}`);
  const { data } = await res.json();
  return (data ?? []).map(normaliseMangadex);
}

/** Deterministic pseudo-random so a re-seed produces the same shelf. */
function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => (x = (x * 1103515245 + 12345) >>> 0) / 2 ** 32;
}

async function addSeries(meta, opts = {}) {
  const volumes = opts.forceVolumes ?? (meta.volumes > 0 ? meta.volumes : 12);
  const viaMangadex = Boolean(meta.mangadex_id);
  const res = await api(
    "POST",
    viaMangadex ? "/api/user/library/mangadex" : "/api/user/library",
    {
      ...(viaMangadex
        ? { mangadex_id: meta.mangadex_id }
        : { mal_id: meta.mal_id }),
      name: meta.name,
      volumes,
      volumes_owned: 0,
      image_url_jpg: meta.image_url_jpg,
      genres: meta.genres,
    },
  );
  if (res.status === 409) {
    console.log(`  · ${meta.name} already in library`);
    return "exists";
  }
  if (!res.ok)
    throw new Error(`POST (${meta.name}) → ${res.status} ${await res.text()}`);
  // MangaDex entries get a server-minted negative mal_id; read it back
  // so the volume marking below can address the right series.
  if (viaMangadex) {
    const created = await res.json().catch(() => null);
    meta.mal_id =
      created?.newEntry?.mal_id ??
      created?.mal_id ??
      created?.entry?.mal_id ??
      meta.mal_id;
  }
  return "added";
}

async function markVolumes(
  meta,
  share,
  rand,
  { readShare = 0.6, price = null, store = null } = {},
) {
  const res = await api("GET", `/api/user/volume/${meta.mal_id}`);
  if (!res.ok) return 0;
  const vols = (await res.json()).sort((a, b) => a.vol_num - b.vol_num);
  const upto = Math.floor(vols.length * share);
  let owned = 0;
  for (const v of vols.slice(0, upto)) {
    const r = await api("PATCH", "/api/user/volume", {
      id: v.id,
      owned: true,
      price: price ?? Number((6.9 + rand() * 6).toFixed(2)),
      store:
        store ??
        ["Fnac", "Cultura", "Momie", "Amazon", "Librairie du coin"][
          Math.floor(rand() * 5)
        ],
      collector: rand() < 0.08,
      read: rand() < readShare,
    });
    if (r.ok) owned++;
    await sleep(15);
  }
  if (owned) await api("PATCH", `/api/user/library/${meta.mal_id}/${owned}`);
  return owned;
}

async function main() {
  console.log(
    `seeding ${SERVER} as "${USERNAME}" (origin ${ORIGIN})${BIG ? " — big library" : ""}`,
  );
  await login();
  const rand = rng(20260912);
  const seen = new Set();
  let added = 0;

  const seedOne = async (meta) => {
    const key = meta?.mangadex_id ?? meta?.mal_id;
    if (!meta || key == null || seen.has(key)) return;
    seen.add(key);
    const opts = {};
    // Ongoing series report `volumes: null` on MAL. One Piece is the
    // 100+ tome case the volume-grid virtualization exists for — pin it.
    if (meta.mal_id === 13 || meta.forceVolumes)
      opts.forceVolumes = meta.forceVolumes ?? 110;
    const outcome = await addSeries(meta, opts);
    if (outcome !== "added") return;
    added++;
    // Ownership profile: complete a third of the shelf, leave some
    // untouched, partially collect the rest — a believable mix.
    const roll = rand();
    const share = roll < 0.3 ? 1 : roll < 0.45 ? 0 : 0.2 + rand() * 0.6;
    const owned = await markVolumes(meta, share, rand);
    console.log(
      `  + ${meta.name} — ${opts.forceVolumes ?? meta.volumes ?? 0} vol, ${owned} owned`,
    );
  };

  for (const [id, title] of ONLY_BIG ? [] : CORE) {
    let meta = null;
    try {
      meta = await lookupById(id);
    } catch (e) {
      // Jikan's edge 504s on cache-miss ids while MAL is slow upstream.
      // Fall back to MangaDex by title — the same second source the
      // Add page offers when MAL can't serve a series.
      console.log(`  ~ #${id} ${title}: ${e.message} → MangaDex`);
      try {
        meta = await mangadexByTitle(title);
      } catch (e2) {
        console.log(`  ✗ ${title}: ${e2.message}`);
      }
      if (!meta)
        console.log(
          `  ✗ ${title}: no MangaDex hit whose title matches — skipped`,
        );
    }
    if (meta && id === 13 && !meta.mal_id) meta.forceVolumes = 110; // keep the 100+ case even via MangaDex
    try {
      await seedOne(meta);
    } catch (e) {
      console.log(`  ✗ ${title}: ${e.message}`);
    }
  }
  if (BIG) {
    let metas = [];
    try {
      metas = await mangadexTop(MANGADEX_TOP);
    } catch (e) {
      console.log(`  ✗ mangadex top: ${e.message}`);
    }
    for (const meta of metas) {
      try {
        await seedOne(meta);
      } catch (e) {
        console.log(`  ✗ ${meta.name}: ${e.message}`);
      }
      await sleep(80);
    }
  }
  console.log(`\n✓ done — ${added} series added`);
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
});
