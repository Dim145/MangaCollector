#!/usr/bin/env node
/*
 * 帳 · Real-stack check for the MyAnimeList XML export import.
 *
 * Builds the XML MyAnimeList hands out (Profile → Export), posts it to
 * POST /api/user/import/external/mal-xml as a fresh user, and checks the
 * mapping the collector cares about through the API, end to end:
 *   - `my_retail_volumes` (bought) wins over `my_read_volumes`
 *   - an unknown total (manga_volumes = 0) still tracks the owned run
 *   - "Completed" with a known total owns the whole run
 *   - "Plan to Read" lands as a wishlist entry (tracked, none owned)
 *   - CDATA / entity titles and comments come through intact
 *   - entries without a MAL id are skipped, junk input is a 400
 * Then commits the previewed bundle and reads the library + volumes back.
 *
 * Usage: node scripts/verify-mal-xml-import.mjs   (stack up, server on :3000)
 */
import { login } from "./lib/stack-client.mjs";

const USER = `xml-check-${Date.now().toString(36)}`;

const XML = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo>
    <user_id>424242</user_id>
    <user_name>collector</user_name>
    <user_export_type>2</user_export_type>
    <user_total_manga>5</user_total_manga>
  </myinfo>
  <manga>
    <manga_mangadb_id>13</manga_mangadb_id>
    <manga_title><![CDATA[One Piece]]></manga_title>
    <manga_volumes>0</manga_volumes>
    <manga_chapters>0</manga_chapters>
    <my_read_volumes>10</my_read_volumes>
    <my_retail_volumes>12</my_retail_volumes>
    <my_status>Reading</my_status>
    <my_score>9</my_score>
    <my_comments><![CDATA[Relu trois fois — édition & co.]]></my_comments>
    <my_times_read>2</my_times_read>
    <update_on_import>0</update_on_import>
  </manga>
  <manga>
    <manga_mangadb_id>656</manga_mangadb_id>
    <manga_title><![CDATA[Vagabond]]></manga_title>
    <manga_volumes>37</manga_volumes>
    <my_read_volumes>0</my_read_volumes>
    <my_retail_volumes>0</my_retail_volumes>
    <my_status>Completed</my_status>
    <my_comments><![CDATA[]]></my_comments>
  </manga>
  <manga>
    <manga_mangadb_id>21</manga_mangadb_id>
    <manga_title>Death Note &amp; extras</manga_title>
    <manga_volumes>12</manga_volumes>
    <my_read_volumes>7</my_read_volumes>
    <my_retail_volumes>0</my_retail_volumes>
    <my_status>Reading</my_status>
  </manga>
  <manga>
    <manga_mangadb_id>1</manga_mangadb_id>
    <manga_title><![CDATA[Monster]]></manga_title>
    <manga_volumes>18</manga_volumes>
    <my_read_volumes>0</my_read_volumes>
    <my_retail_volumes>0</my_retail_volumes>
    <my_status>Plan to Read</my_status>
  </manga>
  <manga>
    <manga_mangadb_id>0</manga_mangadb_id>
    <manga_title><![CDATA[Ghost without id]]></manga_title>
    <manga_volumes>3</manga_volumes>
  </manga>
</myanimelist>`;

const EXPECT = {
  13: { name: "One Piece", volumes: 12, owned: 12, review: "Relu trois fois — édition & co." },
  656: { name: "Vagabond", volumes: 37, owned: 37, review: null },
  21: { name: "Death Note & extras", volumes: 12, owned: 7, review: null },
  1: { name: "Monster", volumes: 18, owned: 0, review: null },
};

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
};

const c = await login(USER);
console.log(`fresh user ${USER} (id ${c.user.id})`);

// junk input is rejected, not imported as nothing
const junk = await c.api("POST", "/api/user/import/external/mal-xml", { xml: "mal_id,title\n13,One Piece" });
check(junk.status === 400, `junk input → ${junk.status} (expected 400)`);

// preview
const { bundle, preview } = await c.json("POST", "/api/user/import/external/mal-xml", { xml: XML });
check(preview.added === 4 && preview.skipped_invalid === 0 && preview.skipped_conflict === 0,
  `preview: added ${preview.added}, invalid ${preview.skipped_invalid}, conflicts ${preview.skipped_conflict} (expected 4/0/0)`);
check(bundle.library.length === 4, `bundle carries ${bundle.library.length} series (the id-0 ghost is skipped)`);
for (const [id, e] of Object.entries(EXPECT)) {
  const s = bundle.library.find((x) => x.mal_id === Number(id));
  check(s && s.name === e.name && s.volumes === e.volumes && s.volumes_owned === e.owned && (s.review ?? null) === e.review,
    `bundle ${e.name}: ${s?.volumes_owned}/${s?.volumes} owned, review ${JSON.stringify(s?.review ?? null)}`);
}

// commit and read back through the regular API
const committed = await c.json("POST", "/api/user/import", { dry_run: false, bundle });
check(committed.added === 4, `commit: added ${committed.added}`);
const lib = await c.json("GET", "/api/user/library");
check(lib.length === 4, `library has ${lib.length} series`);
for (const [id, e] of Object.entries(EXPECT)) {
  const row = lib.find((x) => x.mal_id === Number(id));
  const vols = await c.json("GET", `/api/user/volume/${id}`);
  const owned = vols.filter((v) => v.owned).length;
  check(row && row.volumes === e.volumes && row.volumes_owned === e.owned && vols.length === e.volumes && owned === e.owned,
    `${e.name}: ${owned}/${vols.length} volume rows owned, library says ${row?.volumes_owned}/${row?.volumes}`);
  check((row?.review ?? null) === e.review && row?.review_public === false,
    `${e.name}: review ${JSON.stringify(row?.review ?? null)}, private`);
}

console.log(failures === 0 ? "\n✓ MAL XML import: ALL GOOD" : `\n✗ MAL XML import: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
