# Release Calendar Proxy — protocol

This document specifies **the HTTP contract** a third-party service must
implement to act as a release-calendar proxy for Mangacollector. Any
implementation that honours the endpoints described below can replace the
reference implementation (`manga-release-proxy`, written in Rust). The goal is
to allow rewriting this service in any language / framework without touching
Mangacollector itself.

---

## 1. Why a proxy?

Mangacollector delegates the collection of upcoming-volume announcements to an
external service. This:

- **keeps the backend lightweight** — scraping ~10 publisher catalogues + the
  metadata APIs (ANN, MangaUpdates) lives outside the main process;
- **makes the feature opt-in** — without a proxy configured, the Calendar
  feature is disabled and Mangacollector keeps running without any knowledge
  of upcoming releases;
- **scales independently** — the proxy can be deployed across multiple
  replicas behind a shared Redis cache, with no impact on the main backend.

Mangacollector keeps Google Books **in-process** (a single lightweight HTTP
call) and merges its results with whatever the proxy returns. Everything else
(publishers, ANN, MangaUpdates, OpenLibrary…) lives in the proxy.

---

## 2. Wiring a proxy to Mangacollector

On the Mangacollector side, two environment variables control the connection:

| Variable | Default | Role |
|---|---|---|
| `EXTERNAL_PROXY_URL` | *(unset)* | Base URL of the proxy (e.g. `http://manga-release-proxy:3001`). **When this variable is unset or empty, the Calendar feature is fully disabled** — `discover_upcoming_with_locale` returns an empty list without calling anything. |
| `EXTERNAL_PROXY_TIMEOUT_SECS` | `150` | HTTP timeout per request to the proxy. Must stay **≥ 30 s above** the proxy's `AGGREGATE_DEADLINE_SECS` (cf. §6) to absorb serialization and network transit time. |

No other configuration is required on the Mangacollector side. The proxy is
called without authentication — it is expected to run on an internal,
non-publicly-exposed network (Docker intranet, VPC, k8s service).

---

## 3. Endpoints

A compliant proxy **must** expose two HTTP `GET` endpoints, returning
`Content-Type: application/json` responses (except `/health`).

### 3.1 `GET /health`

Liveness probe. Must respond **quickly** without touching any upstream source
(no publisher fetch, no Jikan, no MangaDex).

| Element | Expected value |
|---|---|
| Status | `200 OK` |
| Body | `ok` (text/plain) or `{"status":"ok"}` (application/json) — Mangacollector does not read this body. |

```bash
$ curl http://manga-release-proxy:3001/health
ok
```

### 3.2 `GET /v1/upcoming`

The only functionally meaningful endpoint. Resolves a manga identifier to its
list of **upcoming volumes** for the requested markets.

#### Query string parameters

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `mal_id` | integer (i32 / i64) | at least one of the two | — | MyAnimeList manga id. |
| `mangadex_id` | string (UUID v4) | at least one of the two | — | MangaDex manga id. |
| `locales` | comma-separated string | no | `fr,en` | ISO 639-1 codes joined by commas (e.g. `fr,en,es`). The special code `any` may be included to force "language-agnostic" sources. |

**At least one of the two identifiers** (`mal_id` or `mangadex_id`) must be
supplied. A request with neither **must** return `400 Bad Request` with a JSON
body describing the error.

```bash
# Typical request — Mangacollector always sends mal_id, sometimes mangadex_id
$ curl 'http://manga-release-proxy:3001/v1/upcoming?mal_id=13&locales=fr,en'
```

#### Expected return codes

| Code | When? | Mangacollector-side behaviour |
|---|---|---|
| `200 OK` | Normal response, valid JSON body. | Parse + merge with its own Google Books hits. |
| `400 Bad Request` | Invalid parameters (no id, malformed locales). | Logs, returns an empty cascade. |
| `429 Too Many Requests` | Rate limit exceeded. | Logs, returns an empty cascade. |
| `5xx` / timeout / connect error | Proxy down or broken. | Logs at DEBUG, returns an empty cascade. **No error is propagated to the user** — the feature degrades gracefully. |

---

## 4. JSON response format

The body of a `200 OK` on `/v1/upcoming` must conform to this schema:

```jsonc
{
  // Stable key for the series, usable for client-side de-duplication.
  // Format: "mal:{id}" if mal_id was supplied, otherwise "mangadex:{id}".
  "key": "mal:13",

  // Alternate titles resolved from MAL and/or MangaDex.
  // The order is SIGNIFICANT: the titles most likely to match publisher
  // slugs come first. Mangacollector does not consume this field
  // directly — it is for debugging and result transparency.
  "titles": [
    "One Piece",
    "ワンピース",
    "ONE PIECE"
  ],

  // List of upcoming volumes, sorted by `release_date` ascending.
  // MAY be empty even on success (the series has no announcement).
  "releases": [
    {
      // Slug identifier of the source that produced this row.
      // Typical values: "ann", "mangaupdates", "kioon", "glenat",
      // "delcourt", "akata", "imho", "pika", "kurokawa", "seven_seas".
      // Another implementation may introduce its own identifiers;
      // Mangacollector maps anything that is not "ann" / "mangaupdates"
      // to the "editor" origin internally.
      "source": "ann",

      // Title as the source publishes it. Not necessarily identical to
      // the canonical `titles` entry — may be in the target language.
      "series_title": "One Piece",

      // Announced volume number. Positive integer.
      "vol_num": 112,

      // Release date in ISO 8601 (UTC). MUST be in the future — the
      // proxy filters past announcements before responding.
      "release_date": "2026-07-07T00:00:00Z",

      // Optional — ISBN-13 when the source provides it, otherwise `null`.
      "isbn": "9782344075500",

      // Optional — URL of the product page on the source, otherwise `null`.
      // Mangacollector uses it as a pre-order link in the drawer.
      "url": "https://www.glenat.com/glenat-manga/one-piece-tome-112-...",

      // Locale of the release in ISO 639-1. `null` for language-agnostic
      // sources (ANN, MangaUpdates).
      "locale": "fr"
    }
  ]
}
```

### Content guarantees

For an implementation to be considered correct, it **must**:

- only return `release_date` values strictly in the future (at the moment the
  response is computed);
- de-duplicate identical rows on `(source, locale, vol_num, release_date)`;
- sort `releases` by `release_date` ascending (the first row is the next
  release);
- always provide the `{source, series_title, vol_num, release_date}` quadruple —
  the three other fields (`isbn`, `url`, `locale`) may be `null`;
- respond in **less than 150 seconds** in the worst case (otherwise
  Mangacollector cuts the connection).

---

## 5. Concrete examples

Three real responses captured against the reference implementation (port
`3001`, warm cache). They cover the three cases a correct proxy must handle:
rich multi-source success, success via cross-source title resolution, and
graceful failure when no title matches the publisher slugs.

### 5.1 Massive multi-source success — One Piece (`mal_id=13`)

```bash
$ curl 'http://localhost:3001/v1/upcoming?mal_id=13&locales=fr,en'
```

```json
{
  "key": "mal:13",
  "titles": [
    "One Piece",
    "One Piece: Ace’s Story—The Manga",
    "One Piece Episode Ace",
    "ワンピース エピソード A",
    "ワンピース エピソード エース",
    "Roronoa Zoro, Umi ni Chiru",
    "ロロノア・ゾロ海に散る",
    "Ван Піс: Ророноа Зоро за бортом",
    "One Piece Special - Boichi Crossover",
    "ナミvsカリファ",
    "One Piece Episode A",
    "Roronoa Zoro Falls Into the Sea",
    "Nami vs. Kalifa"
  ],
  "releases": [
    {
      "source": "glenat",
      "series_title": "One Piece Roman - Novel Heroines",
      "vol_num": 2,
      "release_date": "2026-05-06T00:00:00Z",
      "isbn": "9782344075357",
      "url": "https://www.glenat.com/glenat-manga/one-piece-roman-novel-heroines-tome-02-9782344075357/",
      "locale": "fr"
    },
    {
      "source": "glenat",
      "series_title": "One Piece Vivre Card - Saison 01",
      "vol_num": 7,
      "release_date": "2026-05-06T00:00:00Z",
      "isbn": "9782344071229",
      "url": "https://www.glenat.com/glenat-manga/one-piece-vivre-cards-saison-01-tome-07-9782344071229/",
      "locale": "fr"
    },
    {
      "source": "glenat",
      "series_title": "One Piece Vivre Card - Saison 01",
      "vol_num": 8,
      "release_date": "2026-06-03T00:00:00Z",
      "isbn": "9782344071236",
      "url": "https://www.glenat.com/glenat-manga/one-piece-vivre-card-saison-01-tome-08-9782344071236/",
      "locale": "fr"
    },
    {
      "source": "glenat",
      "series_title": "One Piece Magazine",
      "vol_num": 16,
      "release_date": "2026-06-17T00:00:00Z",
      "isbn": "9782344070437",
      "url": "https://www.glenat.com/glenat-manga/one-piece-magazine-tome-16-9782344070437/",
      "locale": "fr"
    },
    {
      "source": "glenat",
      "series_title": "One Piece Vivre Card - Saison 01",
      "vol_num": 9,
      "release_date": "2026-07-01T00:00:00Z",
      "isbn": "9782344071243",
      "url": "https://www.glenat.com/glenat-manga/one-piece-vivre-card-saison-01-tome-09-9782344071243/",
      "locale": "fr"
    },
    {
      "source": "ann",
      "series_title": "One Piece",
      "vol_num": 112,
      "release_date": "2026-07-07T00:00:00Z",
      "isbn": null,
      "url": null,
      "locale": null
    },
    {
      "source": "ann",
      "series_title": "One Piece",
      "vol_num": 113,
      "release_date": "2026-11-10T00:00:00Z",
      "isbn": null,
      "url": null,
      "locale": null
    }
  ]
}
```

**Reading** — Glénat serves 5 rows for the spin-offs (Vivre Card, Magazine,
Roman) with ISBN + product URL, locale `fr`. ANN serves 2 rows for upcoming
main-line volumes, with no ISBN, no URL, and `locale: null` — ANN is not
market-specific, its dates are international announcements.

Note that the Glénat `series_title` values are **sub-series** (« One Piece
Vivre Card », « One Piece Magazine »), not the main trunk. Mangacollector
surfaces them to the user as-is.

### 5.2 Success via cross-source enrichment — Slime (`mal_id=87609`)

```bash
$ curl 'http://localhost:3001/v1/upcoming?mal_id=87609&locales=fr,en'
```

```json
{
  "key": "mal:87609",
  "titles": [
    "Tensei shitara Slime Datta Ken",
    "Regarding Reincarnated to Slime",
    "That Time I Got Reincarnated as a Slime",
    "Re: My Reincarnation as a Slime",
    "Moi, quand je me réincarne en Slime",
    "TenSura",
    "Odrodzony jako galareta",
    "転生したらスライムだった件",
    "Tensei Slime",
    "TenSli",
    "In Regards to My Reincarnation as a Slime",
    "Vita da Slime",
    "О моём перерождении в слизь",
    "เกิดใหม่ทั้งทีก็เป็นสไลม์ไปซะแล้ว",
    "关于我转生后成为史莱姆的那件事",
    "전생했더니 슬라임이었던 건에 대하여",
    "Aquella vez que me convertí en Slime",
    "ذلك الوقت الذي تجسدت فيه كسلايم",
    "Kun jälleensynnyin hirviönä",
    "O zaman bir balçık olarak reenkarne oldum",
    "O zaman bir slime olarak reenkarne oldum",
    "Meine Wiedergeburt als Schleim in einer anderen Welt",
    "Lúc Đó Tôi Đã Chuyển Sinh Thành Slime"
  ],
  "releases": [
    {
      "source": "kurokawa",
      "series_title": "Moi, quand je me réincarne en Slime",
      "vol_num": 30,
      "release_date": "2026-07-02T00:00:00Z",
      "isbn": "9791042021825",
      "url": "https://www.lisez.com/livres/moi-quand-je-me-reincarne-en-slime-tome-30/9791042021825",
      "locale": "fr"
    },
    {
      "source": "kurokawa",
      "series_title": "Moi, quand je me réincarne en Slime - Trinité",
      "vol_num": 11,
      "release_date": "2026-08-20T00:00:00Z",
      "isbn": "9791042021856",
      "url": "https://www.lisez.com/livres/moi-quand-je-me-reincarne-en-slime-trinite-tome-11/9791042021856",
      "locale": "fr"
    }
  ]
}
```

**Reading** — The most instructive case. The caller supplied only a `mal_id`,
yet MAL returns « Tensei shitara Slime Datta Ken » as the canonical title — a
romaji form that doesn't match any French publisher slug. **Without
cross-source resolution**, the FR scrapers (Kurokawa via Lisez.com) would find
nothing.

The reference implementation detects that `mangadex_id` is absent, fires a
**MangaDex search by the MAL canonical title**, harvests the multilingual
`altTitles`, and that's where the French title « Moi, quand je me réincarne en
Slime » comes from (position 5 in `titles`). Once that title is injected into
the candidate list, the Kurokawa scraper substring-matches the URL
`/livres/moi-quand-je-me-reincarne-en-slime-tome-30/...` and lifts the entry.

An implementer who skips this cross-search step will see their proxy return
`releases: []` for the majority of French-translated series — all the value is
in this resolution step.

### 5.3 Graceful failure — Frieren (`mal_id=126287`)

```bash
$ curl 'http://localhost:3001/v1/upcoming?mal_id=126287&locales=fr'
```

```json
{
  "key": "mal:126287",
  "titles": [
    "Sousou no Frieren",
    "Frieren at the Funeral",
    "Frieren: Beyond Journey's End",
    "Frieren the Slayer",
    "葬送のフリーレン",
    "Фрирен, провожающая в последний путь",
    "葬送的芙莉蓮",
    "장송의 프리렌",
    "คำอธิษฐานในวันที่จากลา Frieren",
    "Φρίρεν: Πέρα από το Τέλος του Ταξιδιού",
    "Frieren: Nach dem Ende der Reise",
    "Frieren: Remnants Of The Departed",
    "Frieren: Más allá del final",
    "Frieren: Más allá del fin del viaje",
    "Pháp Sư Tiễn Táng Frieren"
  ],
  "releases": []
}
```

**Reading** — Frieren IS published in France (by Ki-oon) under the short title
« Frieren ». And yet, the proxy returns `releases: []`. Why?

None of the 15 alternate titles resolved from MAL/MangaDex is exactly
« Frieren » alone — they all carry a sub-title (« Sousou no Frieren »,
« Frieren the Slayer », « Frieren: Beyond Journey's End »…). The scrapers'
slug-substring matching is one-directional: it checks that **the publisher's
URL slug contains the user-title slug**, not the reverse. So:

- user slug (from « Frieren the Slayer ») → `frieren-the-slayer`
- Ki-oon URL slug → `frieren`
- `"frieren".contains("frieren-the-slayer")` → **false**

No match, no row. **The proxy responds `200 OK` with an empty list** — that is
the expected behaviour. It does **not** return an HTTP error, does not log at
`WARN`, propagates nothing to Mangacollector. The feature degrades silently
and the user simply sees "no announcement" in their calendar.

An implementer wanting to improve this case could add a more tolerant matching
heuristic (Levenshtein, prefix matching in both directions, pivot-word
detection). The HTTP contract imposes nothing — this is an optimization
opportunity left to each implementation.

---

## 6. Operational constraints

### 6.1 Cache

An implementation **should** cache at multiple levels to avoid traversing the
entire source network on every request. Recommended TTLs (mirroring the
reference implementation):

| Layer | Recommended TTL | Rationale |
|---|---|---|
| `id → titles` mapping (Jikan, MangaDex) | **7 days** | Canonical titles rarely change. |
| Publisher sitemaps | **24 h** | Publisher calendars evolve on a weekly cycle. |
| Individual product pages | **24 h** | Consistent with sitemaps. |
| Aggregated response per series | `min(next_release - now, 24 h)` | 24 h cap to absorb publisher reschedules (a T15 slipping by a week). |
| Negative cache miss ("no hits") | **24 h** | Avoids hammering for series with no announcements. |

The reference implementation uses Redis with a `moka` in-memory fallback;
another proxy may use Memcached, SQLite, or even a simple `HashMap` — the HTTP
contract is silent on the matter.

### 6.2 Time budget (deadline)

Cold-cache scraping for a popular series can generate 50-100 outbound requests
(sitemaps + product pages across multiple publishers). An implementation must:

- define a **global deadline** (default 120 s in the reference);
- **harvest partial results** from the sources that already finished when the
  deadline trips — **NEVER** return `Vec::new()` on global timeout, lest it
  mask all the sources that had already responded;
- **not cache** a partial response (deadline-aborted), to give the next call a
  chance to go further;
- self-pace against publishers (typically 250-500 ms between fetches on the
  same source) — respectful-scraping ethics.

### 6.3 Rate limiting

Optional but **strongly recommended**: an implementation should rate-limit
incoming requests by source IP to prevent a misconfigured client from
saturating the proxy.

The reference implementation ships with `tower_governor` configured via
`RATE_LIMIT_PER_MINUTE=60` and `RATE_LIMIT_BURST=10`. Another implementation
may use whatever it wants as long as the HTTP contract is honoured (return
`429` with a descriptive JSON body).

### 6.4 Supported locales

An implementation must support at least `fr` and `en`. `es` is a desirable
bonus. The special code `any` (locale-agnostic) must always be accepted and
treated as "also return sources without a linguistic preference".

An unknown locale **must not** trigger a `400` — it should simply be silently
ignored (filtered out of the source dispatch).

### 6.5 Error handling

| Error on the proxy side | Expected action |
|---|---|
| One upstream source times out | Log at DEBUG, exclude it from the response, continue with the others. |
| All sources fail | Return `200 OK` with `releases: []`. **Not** a `5xx`. |
| Malformed Jikan / MangaDex body | Same: title resolution degrades to `[]` but the request succeeds. |
| Internal parse error (panic, bug) | `500 Internal Server Error` — Mangacollector will treat it as empty. |

The general rule: **a correct proxy never returns an error to Mangacollector
that it cannot handle**. Everything is best-effort.

---

## 7. Versioning

The `/v1/` prefix in the main endpoint path documents the contract version.
Any **backwards-compatible** change (adding optional fields to the response,
new locale, new informational status code) stays under `/v1/`. Any **breaking**
change (schema change, field removal) will introduce `/v2/` alongside `/v1/`
with an overlap period.

Mangacollector consumes `/v1/` exclusively today.
