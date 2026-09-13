#!/usr/bin/env node
/*
 * 写本 · Is the archive a lossless backup? A real test against the stack.
 *
 *   node scripts/verify-archive-roundtrip.mjs
 *
 * 1. Logs in as the seeded user, and first makes sure every field the
 *    data model has is populated somewhere: publisher / edition /
 *    review / author on a few series, loans on a few volumes, a manual
 *    upcoming volume, a coffret (with its collector flag), notes.
 * 2. GET /api/user/export.json → the bundle.
 * 3. Logs in as a FRESH subject and POSTs the bundle to /api/user/import.
 * 4. Reads both users back through the normal API — library, every
 *    series' volumes, every series' coffrets — normalises the fields
 *    that legitimately differ (ids, user_id, timestamps, minted custom
 *    ids), and diffs the rest field by field.
 *
 * 5. Then the scenario a backup exists for: the ORIGINAL account damages
 *    its own data (publisher cleared, a loan returned, a note wiped, a
 *    coffret deleted) and restores from the bundle with `mode: replace`.
 *    Its API view must match the snapshot taken before the damage.
 *
 * Exit 0 when both scenarios are lossless; exit 1 with a per-field loss
 * table otherwise. Comparing API views rather than "export → import →
 * export" is the point: the bundle cannot fail to round-trip a field it
 * never carried.
 */
import { login } from "./lib/stack-client.mjs";

const SOURCE = process.env.SEED_USER ?? "test-collector";
const TARGET = process.env.RESTORE_USER ?? `restore-check-${Date.now().toString(36)}`;
const FRIEND = "friend-alex"; // followed by the source; one loan is linked to this account

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k] ?? null]));
const by = (k) => (a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0);

/* ─── 1. enrich the source so every field has data ─────────────────── */
async function enrich(c) {
  const lib = await c.json("GET", "/api/user/library");
  // deterministic picks: the first MAL series, the first MangaDex series, the biggest
  const mal = lib.filter((s) => s.mal_id > 0).sort(by("mal_id"));
  const md = lib.filter((s) => s.mangadex_id).sort(by("name"));
  const big = [...lib].sort((a, b) => b.volumes - a.volumes)[0];
  const targets = [...new Set([mal[0], mal[1], md[0], big].filter(Boolean))];
  const log = [];

  for (const [i, s] of targets.entries()) {
    await c.json("PATCH", `/api/user/library/${s.mal_id}`, {
      publisher: `Éditeur ${i + 1}`,
      edition: i % 2 ? "Deluxe" : "Standard",
      review: `Avis de test n°${i + 1} — ${s.name}`,
      review_public: i % 2 === 0,
      author: `Auteur Test ${i + 1}`,
    });
    log.push(`series fields on ${s.name}`);
  }

  // reading progression set by hand on the second MAL series
  const handRead = mal[1] ?? mal[0];
  await c.json("PATCH", `/api/user/library/${handRead.mal_id}`, {
    reading_status: "paused",
    started_reading_at: "2025-01-15",
    finished_reading_at: null,
    times_read: 1,
  });
  log.push(`reading fields by hand on ${handRead.name}`);

  // derived progression: mark a small series fully read → completed with
  // dates, then start a re-read → tally +1, everything unread again
  const small = [...lib].filter((s) => s.volumes >= 3 && s.volumes <= 12 && s.mal_id !== handRead.mal_id && s.mal_id !== big.mal_id)
    .sort((a, b) => a.volumes - b.volumes)[0];
  if (small) {
    await c.json("POST", `/api/user/library/${small.mal_id}/volumes/bulk-mark`, { read: true });
    const done = await c.json("GET", `/api/user/library/${small.mal_id}`);
    const doneRow = Array.isArray(done) ? done[0] : done;
    if (doneRow.reading_status !== "completed" || !doneRow.finished_reading_at || !doneRow.started_reading_at) {
      throw new Error(`${small.name}: expected completed with dates after bulk read, got ${JSON.stringify([doneRow.reading_status, doneRow.started_reading_at, doneRow.finished_reading_at])}`);
    }
    const before = doneRow.times_read;
    await c.json("POST", `/api/user/library/${small.mal_id}/reread`);
    const again = await c.json("GET", `/api/user/library/${small.mal_id}`);
    const againRow = Array.isArray(again) ? again[0] : again;
    const stillRead = (await c.json("GET", `/api/user/volume/${small.mal_id}`)).filter((v) => v.read_at).length;
    if (againRow.times_read !== before + 1 || againRow.reading_status !== "reading" || againRow.finished_reading_at || stillRead !== 0) {
      throw new Error(`${small.name}: re-read expected times_read ${before + 1}/reading/no finish/0 read, got ${JSON.stringify([againRow.times_read, againRow.reading_status, againRow.finished_reading_at, stillRead])}`);
    }
    log.push(`${small.name}: bulk read → completed, re-read → lap ${againRow.times_read}, ${small.volumes} tomes unread again`);
  }

  // a friend account the source follows — the first loan is linked to it,
  // so the bundle carries a borrower slug and the friend's "borrowed"
  // list has to show the volume
  const friend = await login(FRIEND);
  const slugged = await friend.api("PATCH", "/api/user/public-slug", { slug: FRIEND });
  if (!slugged.ok && slugged.status !== 409) throw new Error(`friend slug → ${slugged.status}`);
  const fol = await c.api("POST", `/api/user/follows/${FRIEND}`);
  if (!fol.ok && fol.status !== 409) throw new Error(`follow ${FRIEND} → ${fol.status}`);
  log.push(`follows ${FRIEND} (user ${friend.user.id})`);

  // loans + notes on the big series' first volumes
  const vols = (await c.json("GET", `/api/user/volume/${big.mal_id}`)).sort(by("vol_num"));
  for (const [i, v] of vols.slice(0, 3).entries()) {
    await c.json("PATCH", "/api/user/volume", {
      id: v.id,
      owned: true,
      price: v.price ?? 7.5,
      store: v.store ?? "Librairie test",
      collector: i === 0,
      read: true,
      notes: `Note de test ${i + 1}`,
      // the physical copy — grade, shelf, doubles, purchase day
      condition: ["new", "good", "fair"][i],
      location: i === 2 ? "Carton grenier" : "Étagère A",
      extra_copies: i,
      bought_at: `2024-0${i + 3}-15`,
      loan: {
        to: i === 0 ? "Alex (ami)" : `Ami ${i + 1}`,
        due_at: new Date(Date.now() + (i + 1) * 7 * 86400000).toISOString(),
        to_user_id: i === 0 ? friend.user.id : null,
      },
    });
  }
  log.push(`3 loans + notes on ${big.name} (vol ${vols[0].vol_num} linked to ${FRIEND})`);
  const borrowed = await friend.json("GET", "/api/user/volume/loans/borrowed");
  const mine = borrowed.filter((b) => b.lender_id === c.user.id && b.vol_num === vols[0].vol_num);
  if (mine.length !== 1) throw new Error(`${FRIEND}'s borrowed list should show vol ${vols[0].vol_num} once, got ${mine.length}`);
  log.push(`${FRIEND} sees "${mine[0].series_name}" #${mine[0].vol_num} under borrowed`);

  // a manually pencilled upcoming volume (409 = already there from a previous run)
  const up = await c.api("POST", `/api/user/library/${big.mal_id}/volumes/upcoming`, {
    vol_num: big.volumes + 1,
    release_date: new Date(Date.now() + 60 * 86400000).toISOString(),
    release_isbn: "9782505011514",
    release_url: "https://example.invalid/tome",
  });
  if (!up.ok && up.status !== 409) throw new Error(`upcoming volume → ${up.status}`);
  log.push(`upcoming volume ${big.volumes + 1} on ${big.name}${up.status === 409 ? " (already there)" : ""}`);

  // a coffret with its collector flag
  const existing = await c.json("GET", `/api/user/library/${big.mal_id}/coffrets`);
  if (!existing.length) {
    await c.json("POST", `/api/user/library/${big.mal_id}/coffrets`, {
      name: "Coffret de test",
      vol_start: 4,
      vol_end: 6,
      price: 29.9,
      store: "Boutique test",
      collector: true,
    });
    log.push(`coffret 4–6 on ${big.name}`);
  }
  return log;
}

/* ─── 4. normalised views ──────────────────────────────────────────── */
const SERIES_FIELDS = ["name", "volumes", "volumes_owned", "image_url_jpg", "genres", "mangadex_id",
  "publisher", "edition", "review", "review_public", "author_name", "created_on", "modified_on",
  "reading_status", "started_reading_at", "finished_reading_at", "times_read"];
const VOLUME_FIELDS = ["vol_num", "owned", "price", "store", "collector", "read_at", "notes",
  "release_date", "release_isbn", "release_url", "origin", "announced_at",
  "loaned_to", "loaned_to_user_id", "loan_started_at", "loan_due_at", "in_coffret", "created_on", "modified_on",
  "condition", "location", "extra_copies", "bought_at"];
const COFFRET_FIELDS = ["name", "vol_start", "vol_end", "price", "store", "collector", "created_on", "modified_on"];

async function snapshot(c) {
  const lib = await c.json("GET", "/api/user/library");
  const out = new Map(); // key: mal_id for MAL, "md:<id>" for MangaDex, "custom:<name>" otherwise
  // Two rows sharing a key = the same series twice in one library. That is
  // exactly what re-importing your own backup used to do to every non-MAL
  // series (conflicts were matched on mal_id only, and custom ids are
  // negative per-instance numbers), and a keyed map silently hides it —
  // so count rows and duplicates alongside.
  const dupes = [];
  Object.assign(out, { rows: lib.length, dupes });
  for (const s of lib) {
    const key = s.mal_id > 0 ? `mal:${s.mal_id}` : s.mangadex_id ? `md:${s.mangadex_id}` : `custom:${s.name}`;
    if (out.has(key)) { dupes.push(`${s.name} (${key})`); continue; }
    const vols = (await c.json("GET", `/api/user/volume/${s.mal_id}`)).sort(by("vol_num"));
    const coffrets = (await c.json("GET", `/api/user/library/${s.mal_id}/coffrets`)).sort(by("vol_start"));
    out.set(key, {
      series: { ...pick(s, SERIES_FIELDS), author_name: s.author?.name ?? null, genres: [...(s.genres ?? [])].sort() },
      volumes: vols.map((v) => ({ ...pick(v, VOLUME_FIELDS), in_coffret: v.coffret_id != null,
        // read_at / loan_started_at are server-stamped on write; compare presence, not instant
        read_at: v.read_at ? "set" : null, loan_started_at: v.loan_started_at ? "set" : null, announced_at: v.announced_at ? "set" : null })),
      coffrets: coffrets.map((k) => pick(k, COFFRET_FIELDS)),
    });
  }
  return out;
}

function diff(a, b) {
  const loss = new Map(); // "scope.field" → count
  const bump = (k) => loss.set(k, (loss.get(k) ?? 0) + 1);
  let seriesMissing = 0;
  for (const [key, A] of a) {
    const B = b.get(key);
    if (!B) { seriesMissing++; continue; }
    for (const f of Object.keys(A.series)) {
      if (JSON.stringify(A.series[f]) !== JSON.stringify(B.series[f])) bump(`series.${f}`);
    }
    if (A.volumes.length !== B.volumes.length) bump("volumes.count");
    for (const va of A.volumes) {
      const vb = B.volumes.find((x) => x.vol_num === va.vol_num);
      if (!vb) { bump("volumes.missing"); continue; }
      for (const f of Object.keys(va)) {
        if (JSON.stringify(va[f]) !== JSON.stringify(vb[f])) bump(`volume.${f}`);
      }
    }
    if (A.coffrets.length !== B.coffrets.length) bump("coffrets.count");
    for (const [i, ka] of A.coffrets.entries()) {
      const kb = B.coffrets[i];
      if (!kb) continue;
      for (const f of Object.keys(ka)) {
        if (JSON.stringify(ka[f]) !== JSON.stringify(kb[f])) bump(`coffret.${f}`);
      }
    }
  }
  return { loss, seriesMissing, extraInTarget: [...b.keys()].filter((k) => !a.has(k)).length };
}

/* ─── 5. damage the source, then restore it from its own bundle ──────── */
async function damage(c, snap) {
  const entries = [...snap.entries()];
  const withPublisher = entries.find(([, v]) => v.series.publisher);
  const withLoan = entries.find(([, v]) => v.volumes.some((x) => x.loaned_to));
  const withCoffret = entries.find(([, v]) => v.coffrets.length);
  const lib = await c.json("GET", "/api/user/library");
  const idOf = (key) => {
    if (key.startsWith("mal:")) return Number(key.slice(4));
    if (key.startsWith("md:")) return lib.find((s) => s.mangadex_id === key.slice(3))?.mal_id;
    return lib.find((s) => s.name === key.slice(7))?.mal_id;
  };
  const log = [];
  if (withPublisher) {
    const id = idOf(withPublisher[0]);
    await c.json("PATCH", `/api/user/library/${id}`, { publisher: null, review: null, author: null });
    log.push(`cleared publisher/review/author on ${withPublisher[1].series.name}`);
  }
  if (withLoan) {
    const id = idOf(withLoan[0]);
    const vols = await c.json("GET", `/api/user/volume/${id}`);
    const lent = vols.find((v) => v.loaned_to);
    if (lent) {
      await c.json("PATCH", "/api/user/volume", { id: lent.id, owned: lent.owned, price: lent.price, store: lent.store, collector: lent.collector, notes: null, loan: null });
      log.push(`returned the loan and wiped the note on vol ${lent.vol_num} of ${withLoan[1].series.name}`);
    }
  }
  if (withCoffret) {
    const id = idOf(withCoffret[0]);
    const cofs = await c.json("GET", `/api/user/library/${id}/coffrets`);
    for (const k of cofs) await c.api("DELETE", `/api/user/coffrets/${k.id}`);
    log.push(`deleted ${cofs.length} coffret(s) on ${withCoffret[1].series.name}`);
  }
  return log;
}

function report(label, { loss, seriesMissing, extraInTarget }, a, b) {
  const dupes = [...(a.dupes ?? []), ...(b.dupes ?? [])];
  console.log(`\n[${label}] series: ${a.size} expected (${a.rows} rows), ${b.size} found (${b.rows} rows), ${seriesMissing} missing, ${extraInTarget} extra, ${dupes.length} duplicated`);
  if (loss.size === 0 && seriesMissing === 0 && dupes.length === 0 && a.rows === b.rows) {
    console.log(`✓ ${label}: LOSSLESS`);
    return true;
  }
  console.log(`✗ ${label}: ${loss.size || seriesMissing ? "DATA LOSS" : "DUPLICATED SERIES"}`);
  for (const [k, n] of [...loss].sort((x, y) => y[1] - x[1])) console.log(`    ${k.padEnd(28)} ${n} difference(s)`);
  for (const d of dupes.slice(0, 5)) console.log(`    duplicate: ${d}`);
  if (dupes.length > 5) console.log(`    … ${dupes.length - 5} more duplicates`);
  return false;
}

async function main() {
  console.log(`source: ${SOURCE} → target: ${TARGET}`);
  const src = await login(SOURCE);
  console.log("✓ source logged in");
  for (const line of await enrich(src)) console.log(`  · enriched: ${line}`);

  const bundle = await src.json("GET", "/api/user/export.json");
  console.log(`✓ exported bundle v${bundle.version}: ${bundle.library.length} series`);

  const dst = await login(TARGET);
  // A linked borrower travels as a public slug and is re-linked only when
  // the importing account follows them — a restored account has to
  // rebuild its follows first, as a real user would.
  await dst.api("POST", `/api/user/follows/${FRIEND}`);
  const preview = await dst.json("POST", "/api/user/import", { dry_run: false, bundle });
  console.log(`✓ imported into fresh user: added ${preview.added}, conflicts ${preview.skipped_conflict}, invalid ${preview.skipped_invalid}`);

  console.log("… snapshotting both users through the API");
  const [a, b] = await Promise.all([snapshot(src), snapshot(dst)]);
  const okFresh = report("fresh account, mode=merge", diff(a, b), a, b);

  // Scenario 2 — the original account damages itself, then restores.
  for (const line of await damage(src, a)) console.log(`  · damaged: ${line}`);
  const restore = await src.json("POST", "/api/user/import", { dry_run: false, mode: "replace", bundle });
  console.log(`✓ replace-restore on the original: replaced ${restore.replaced}, added ${restore.added}, skipped ${restore.skipped_conflict}`);
  const a2 = await snapshot(src);
  const okReplace = report("same account, mode=replace", diff(a, a2), a, a2);

  if (!(okFresh && okReplace)) process.exit(1);
}

main().catch((e) => { console.error(`\n✗ ${e.message}`); process.exit(1); });
