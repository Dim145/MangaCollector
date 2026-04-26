//! 来 · Upcoming-volume discovery + reconciliation.
//!
//! Two responsibilities, kept in one file because they share the
//! discovered-volume struct and tracing context:
//!
//!   1. **Discover** — call the API cascade for a given series and
//!      return the announcements as a normalised list.
//!   2. **Reconcile** — diff that list against `user_volumes` rows
//!      for a single user, INSERT new ones, UPDATE in-place when
//!      the date moved, and *never* clobber rows the user marked as
//!      `origin = 'manual'`.
//!
//! The cascade in this Phase-1 cut is intentionally conservative:
//! MangaUpdates only. The richer enrichment (Google Books for
//! ISBN+cover, OpenLibrary fallback, MangaDex high-res cover
//! override) is the Phase-3 polish step. Shipping the simpler cut
//! first keeps the surface area auditable and lets us validate the
//! reconcile-vs-manual contract on production data before adding
//! more sources.

use chrono::{DateTime, Duration, Utc};
use sea_orm::sea_query::OnConflict;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set,
};
use serde::Serialize;
use std::collections::HashMap;

use crate::db::Db;
use crate::errors::AppError;
use crate::models::library::{self as library_mod, Entity as LibraryEntity};
use crate::models::volume::{self, ActiveModel, Entity as VolumeEntity};
use crate::services::cache::CacheStore;
use crate::services::{google_books_api, proxy_client};

/// How far ahead we look for announcements. Twelve months covers
/// every realistic publishing schedule and matches the MangaUpdates
/// cache horizon — past that, the data starts to be more rumour
/// than schedule.
const HORIZON_DAYS: i64 = 365;

/// A volume the cascade found announced. Carries enough metadata
/// for the reconcile pass to populate `user_volumes` without going
/// back to the network.
#[derive(Clone, Debug, Serialize)]
pub struct DiscoveredVolume {
    pub vol_num: i32,
    pub release_date: DateTime<Utc>,
    pub release_isbn: Option<String>,
    pub release_url: Option<String>,
    /// Provenance string written into `user_volumes.origin`. Today
    /// always `"mangaupdates"` since that's the only source we ask;
    /// future cascade tiers will set their own value.
    pub origin: &'static str,
}

/// What `reconcile_user` returns to its caller. Surfaced over the
/// API so the SPA can render a "X added, Y updated" toast.
#[derive(Clone, Debug, Default, Serialize)]
pub struct ReconcileReport {
    /// Newly-inserted upcoming rows.
    pub added: Vec<UpcomingChange>,
    /// Existing upcoming rows whose `release_date` we updated.
    pub updated: Vec<UpcomingChange>,
    /// Rows we considered but left alone — the user had marked
    /// them manual or had already received the volume.
    pub skipped: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct UpcomingChange {
    pub vol_num: i32,
    pub release_date: DateTime<Utc>,
}

/// Run the API cascade for a series and return the raw announcement
/// list, future-only and sorted by volume number.
///
/// The series is identified by its display name (what users typed
/// or what MAL returned) — MangaUpdates is fuzzy-search-driven and
/// works better with the human title than with any of our internal
/// ids. Future iterations may add a fast path through the
/// MangaUpdates `series_id` if we cache it on first hit.
/// 探 · Cascade discovery for upcoming volumes of a series.
///
/// Strategy (rewritten after Phase 3.5 audit found MangaUpdates was
/// the wrong primary — it tracks scanlation chapters, not commercial
/// volume releases):
///
/// 1. **Google Books (primary)** — probe `start_vol .. start_vol + 12`
///    for the requested language. Each hit returns publisher, ISBN,
///    cover URL alongside the future-only `publishedDate`. Early
///    termination after 3 consecutive misses to keep API quota under
///    control on dead-end queries.
/// 2. **MangaUpdates (supplement)** — added in for the rare case
///    where a publisher has a date in MangaUpdates' index but not in
///    Google Books. We only keep volume-only releases (no chapter)
///    here; chapter rows are scanlation noise. Volume-numbered
///    duplicates already found via Google Books are discarded.
/// 3. **OpenLibrary (ISBN fallback)** — for any Google-Books hit that
///    didn't carry an ISBN, query OpenLibrary by (title, vol). Used
///    for completeness, never overrides a non-null ISBN.
///
/// `start_vol` is the lowest volume number to probe — typically the
/// caller's "highest known volume + 1" for the user/series. Lets us
/// avoid burning quota probing tomes the user already has.
///
/// `language_iso` is the 2-letter Google Books locale (`en`, `fr`,
/// `es`, `ja`). Unknown / empty falls back to `"en"`.
pub async fn discover_upcoming_with_locale(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    api_key: Option<&str>,
    series_title: &str,
    start_vol: i32,
    language_iso: &str,
    mal_id: i32,
    proxy_url: Option<&str>,
    proxy_timeout: std::time::Duration,
) -> Result<Vec<DiscoveredVolume>, AppError> {
    // ── Calendar feature gate ────────────────────────────────────────
    // The upcoming-volume cascade is OFF unless `EXTERNAL_PROXY_URL`
    // is configured (per project brief). Without the proxy the heavy
    // sources (publisher scrapers, ANN, MangaUpdates) aren't
    // available, and we don't want a half-feature where only
    // Google Books fires — operators opt into the calendar by
    // deploying the sidecar.
    let proxy_url = match proxy_url {
        Some(u) if !u.trim().is_empty() => u,
        _ => return Ok(Vec::new()),
    };

    let lang = if language_iso.trim().is_empty() {
        "en"
    } else {
        language_iso.trim()
    };
    // Probe horizon — 12 candidate volumes from `start_vol`. A series
    // that ships quarterly drops 4 tomes / year, so 12 covers the
    // 3-year peak any reasonable schedule would expose; slower-paced
    // series will see early termination kick in well before 12.
    const PROBE_DEPTH: i32 = 12;
    const MAX_CONSECUTIVE_MISSES: u32 = 3;

    // ── Tier 1 · Google Books ─────────────────────────────────────────
    let mut google_hits: std::collections::HashMap<i32, DiscoveredVolume> =
        std::collections::HashMap::new();
    let mut consecutive_misses: u32 = 0;
    let lower = start_vol.max(1);
    for v in lower..(lower + PROBE_DEPTH) {
        match google_books_api::find_volume(
            client,
            cache,
            api_key,
            series_title,
            v,
            lang,
        )
        .await
        {
            Ok(Some(hit)) => {
                consecutive_misses = 0;
                google_hits.insert(
                    v,
                    DiscoveredVolume {
                        vol_num: v,
                        release_date: hit.release_date,
                        release_isbn: hit.isbn,
                        release_url: hit.cover_url,
                        origin: "googlebooks",
                    },
                );
            }
            Ok(None) => {
                consecutive_misses += 1;
                if consecutive_misses >= MAX_CONSECUTIVE_MISSES {
                    break;
                }
            }
            Err(err) => {
                tracing::debug!(
                    %err,
                    title = series_title,
                    vol = v,
                    "google_books lookup failed (continuing)"
                );
                consecutive_misses += 1;
                if consecutive_misses >= MAX_CONSECUTIVE_MISSES {
                    break;
                }
            }
        }
    }

    // ── Tier 2 · External proxy ─────────────────────────────────────
    // Single HTTP call to the manga-release-proxy sidecar fans out
    // every publisher scraper + ANN + MangaUpdates in parallel and
    // returns one aggregated payload. The proxy applies its own
    // caching (Redis if configured, in-process moka otherwise) so
    // repeated calls within the day are essentially free.
    //
    // Filtering precedence: Google Books wins when both surfaces have
    // the same volume — its locale-filtered hits are typically
    // higher-confidence + carry ISBNs. The proxy fills gaps Google
    // didn't catch (especially the freshest publisher pre-orders that
    // haven't propagated to Google Books yet).
    let now = Utc::now();
    let until = now + Duration::days(HORIZON_DAYS);
    let proxy_releases = proxy_client::fetch_upcoming(
        client,
        proxy_url,
        Some(mal_id),
        None, // mangadex_id not currently plumbed through; future enhancement
        &[lang],
        proxy_timeout,
    )
    .await;
    for r in proxy_releases {
        // The proxy returns ALL future tomes (option A in the design
        // brief). The server applies the per-user `start_vol` filter
        // so volumes already in the user's library don't surface.
        if r.vol_num < start_vol {
            continue;
        }
        if r.release_date <= now || r.release_date > until {
            continue;
        }
        google_hits.entry(r.vol_num).or_insert(DiscoveredVolume {
            vol_num: r.vol_num,
            release_date: r.release_date,
            release_isbn: r.isbn,
            release_url: r.url,
            origin: proxy_source_to_origin(&r.source),
        });
    }

    let mut out: Vec<DiscoveredVolume> = google_hits.into_values().collect();
    out.sort_by(|a, b| a.vol_num.cmp(&b.vol_num));
    Ok(out)
}

/// Map the proxy's source slug (e.g. `"kioon"`, `"ann"`) to the
/// fixed origin set the rest of the system stores in
/// `user_volumes.origin`. Editor-scraper sources collapse into
/// `"editor"` (granularity not needed downstream); API-based sources
/// keep their identifiers so analytics can distinguish them.
fn proxy_source_to_origin(source: &str) -> &'static str {
    match source {
        "ann" => "ann",
        "mangaupdates" => "mangaupdates",
        // Anything else is a publisher scraper — Akata, Delcourt,
        // Glénat, IMHO, Ki-oon, Kurokawa, Pika, Seven Seas. Single
        // bucket keeps the schema stable; the proxy's per-row `url`
        // field still pinpoints which publisher answered if needed
        // for debugging.
        _ => "editor",
    }
}

/// 探 · Highest volume number this user already has a row for, on
/// the given series. Returns 0 when the user has no row yet — the
/// cascade then probes from volume 1.
///
/// "Highest known" beats "highest owned" intentionally: the user
/// might have an upcoming row at vol=20 already; the probe should
/// start from 21, not from `volumes_owned + 1` which counts only
/// physically-owned tomes and can lag.
pub async fn highest_known_vol_num(
    db: &Db,
    user_id: i32,
    mal_id: i32,
) -> Result<i32, AppError> {
    use sea_orm::QuerySelect;
    use sea_orm::sea_query::Expr;
    let row: Option<Option<i32>> = VolumeEntity::find()
        .select_only()
        .column_as(Expr::col(volume::Column::VolNum).max(), "max_vol")
        .filter(volume::Column::UserId.eq(user_id))
        .filter(volume::Column::MalId.eq(mal_id))
        .into_tuple()
        .one(db)
        .await
        .map_err(AppError::from)?;
    Ok(row.flatten().unwrap_or(0))
}

/// Variant of `highest_known_vol_num` scoped across **every** user
/// who follows the series. Used by the nightly sweep to avoid
/// re-probing volumes any active user already has on file. A user
/// joining the series later catches up via their own manual
/// refresh, which uses `highest_known_vol_num` (per-user).
pub async fn highest_known_vol_num_globally(
    db: &Db,
    mal_id: i32,
) -> Result<i32, AppError> {
    use sea_orm::QuerySelect;
    use sea_orm::sea_query::Expr;
    let row: Option<Option<i32>> = VolumeEntity::find()
        .select_only()
        .column_as(Expr::col(volume::Column::VolNum).max(), "max_vol")
        .filter(volume::Column::MalId.eq(mal_id))
        .into_tuple()
        .one(db)
        .await
        .map_err(AppError::from)?;
    Ok(row.flatten().unwrap_or(0))
}

/// Diff `discovered` against the user's existing `user_volumes` rows
/// for the given `mal_id`. Mutations:
///
///   - INSERT: a `vol_num` that has no corresponding row → mint a
///     fresh upcoming row (origin = source, owned/read/collector
///     forced false/null/false).
///   - UPDATE: an existing API-origin upcoming row whose date moved
///     → write the new date and bump `announced_at`.
///   - SKIP: any of {already-released row, owned, manual origin,
///     no change} — these are sticky and the sweep must not touch
///     them.
///
/// The function is idempotent: running it twice with the same
/// `discovered` is a quiet no-op the second time. Callers expect to
/// be able to retry on transient failures.
pub async fn reconcile_user(
    db: &Db,
    user_id: i32,
    mal_id: i32,
    discovered: &[DiscoveredVolume],
) -> Result<ReconcileReport, AppError> {
    if discovered.is_empty() {
        return Ok(ReconcileReport::default());
    }

    // 印 · Authorisation gate. The caller (handler or background
    // job) supplies (user_id, mal_id) but we want to be confident
    // the user actually has this series in their library before we
    // go inserting volume rows under it. Without this check, a
    // background sweep that spans every series ever queried by
    // anyone would over-grow user_volumes.
    let owns_series = LibraryEntity::find()
        .filter(library_mod::Column::UserId.eq(user_id))
        .filter(library_mod::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?
        .is_some();
    if !owns_series {
        return Ok(ReconcileReport::default());
    }

    // Pull every existing volume row for this (user, series) once
    // so the diff loop below stays in-memory. The series-volume row
    // count is tiny (typical seinen tops out around 30 tomes) — no
    // need to paginate.
    let existing = VolumeEntity::find()
        .filter(volume::Column::UserId.eq(user_id))
        .filter(volume::Column::MalId.eq(mal_id))
        .all(db)
        .await
        .map_err(AppError::from)?;

    let now = Utc::now();
    let mut report = ReconcileReport::default();

    for incoming in discovered {
        let row = existing.iter().find(|r| r.vol_num == incoming.vol_num);

        match row {
            None => {
                // 新 · No row for this volume → fresh insert.
                let model = ActiveModel {
                    created_on: Set(now),
                    modified_on: Set(now),
                    user_id: Set(user_id),
                    mal_id: Set(Some(mal_id)),
                    vol_num: Set(incoming.vol_num),
                    owned: Set(false),
                    price: Set(None),
                    store: Set(Some(String::new())),
                    collector: Set(false),
                    coffret_id: Set(None),
                    read_at: Set(None),
                    release_date: Set(Some(incoming.release_date)),
                    release_isbn: Set(incoming.release_isbn.clone()),
                    release_url: Set(incoming.release_url.clone()),
                    origin: Set(incoming.origin.to_string()),
                    announced_at: Set(Some(now)),
                    ..Default::default()
                };
                // 印 · ON CONFLICT (user_id, mal_id, vol_num) DO NOTHING
                // — race against a concurrent sweep / manual add. The
                // underlying unique index is **partial**:
                //
                //   CREATE UNIQUE INDEX ... ON user_volumes
                //       (user_id, mal_id, vol_num)
                //       WHERE mal_id IS NOT NULL;
                //
                // PostgreSQL refuses ON CONFLICT against a partial
                // index unless the inferred predicate is repeated on
                // the INSERT side — without it the planner says
                // "there is no unique or exclusion constraint
                // matching the ON CONFLICT specification". The
                // `target_and_where` clause below makes the predicate
                // explicit so the partial index is matchable. We're
                // safe to assert `mal_id IS NOT NULL` because the
                // value we set on the row above is `Some(mal_id)`
                // unconditionally for upcoming-volume inserts.
                let res = VolumeEntity::insert(model)
                    .on_conflict(
                        OnConflict::columns([
                            volume::Column::UserId,
                            volume::Column::MalId,
                            volume::Column::VolNum,
                        ])
                        .target_and_where(
                            sea_orm::sea_query::Expr::col(volume::Column::MalId)
                                .is_not_null(),
                        )
                        .do_nothing()
                        .to_owned(),
                    )
                    .exec(db)
                    .await
                    .map_err(AppError::from)?;
                if res.last_insert_id != 0 {
                    report.added.push(UpcomingChange {
                        vol_num: incoming.vol_num,
                        release_date: incoming.release_date,
                    });
                } else {
                    report.skipped += 1;
                }
            }
            Some(row) => {
                // 静 · Row exists. Three reasons to leave it alone:
                //   1. owned=true → the user has it physically; the
                //      announcement is moot.
                //   2. origin=='manual' → user typed in their own
                //      date; sweep is forbidden from overwriting.
                //   3. release_date matches what we'd write → no-op
                //      to avoid spurious modified_on updates.
                let already_released = row
                    .release_date
                    .map(|d| d <= now)
                    .unwrap_or(true);
                let manual = row.origin.as_str() == "manual";
                let unchanged = row.release_date == Some(incoming.release_date);

                if row.owned || manual || already_released || unchanged {
                    report.skipped += 1;
                    continue;
                }

                // UPDATE only the date + announcement timestamp.
                // We deliberately don't touch ISBN / URL / origin
                // here — the user might have hand-cleaned them
                // between two sweeps and we're not the source of
                // truth on those once a row exists.
                let mut active: ActiveModel = row.clone().into();
                active.release_date = Set(Some(incoming.release_date));
                active.announced_at = Set(Some(now));
                active.modified_on = Set(now);
                active.update(db).await.map_err(AppError::from)?;

                report.updated.push(UpcomingChange {
                    vol_num: incoming.vol_num,
                    release_date: incoming.release_date,
                });
            }
        }
    }

    Ok(report)
}

/// One row in the upcoming-calendar feed surfaced to the client.
///
/// Joins enough series-level metadata (name + cover) onto the volume
/// row so the calendar UI can render a card without fanning out into
/// per-mal_id library lookups. The shape mirrors what the SPA already
/// renders for owned volumes — keeps the rendering code dual-use.
#[derive(Clone, Debug, Serialize)]
pub struct CalendarEntry {
    /// `user_volumes.id` — used as the React key + drawer target.
    pub id: i32,
    pub mal_id: i32,
    pub vol_num: i32,
    pub release_date: DateTime<Utc>,
    pub release_isbn: Option<String>,
    pub release_url: Option<String>,
    pub origin: String,
    /// Series name from `user_library.name`. Always populated — the
    /// query filters out volumes whose mal_id has no matching library
    /// row (orphans from a deleted series).
    pub manga_name: String,
    /// Optional series-level cover from `user_library.image_url_jpg`.
    /// May be a CDN URL (MAL / MangaDex) or a server-relative custom
    /// upload path; the SPA already handles both shapes.
    pub image_url_jpg: Option<String>,
    /// Genres pass through so a future filter (e.g. "hide adult") can
    /// run client-side without an extra API call.
    pub genres: Vec<String>,
}

/// 暦 · List the user's upcoming volumes, joined with series metadata,
/// in `[from, until]` and sorted ascending by release date.
///
/// Returns volumes whose `release_date` is non-NULL and lies inside
/// the window. The lower bound `from` is inclusive — passing `Utc::now()`
/// drops volumes that have just shipped (the SPA's calendar surfaces
/// the future, not the past). The upper bound `until` is inclusive too;
/// callers typically pass `now + N months`.
///
/// Implementation note: SeaORM's join API for arbitrary ON conditions
/// is fiddly when entities don't have a declared `Relation`. Two
/// passes is cleaner here — first pull the upcoming volumes, then
/// fetch the matching library rows in a single IN(...) query. For
/// realistic upcoming-volume counts (tens, not thousands) the cost is
/// indistinguishable from a JOIN.
pub async fn list_user_calendar(
    db: &Db,
    user_id: i32,
    from: DateTime<Utc>,
    until: DateTime<Utc>,
) -> Result<Vec<CalendarEntry>, AppError> {
    // Step 1: upcoming volumes for this user, ordered by date.
    // Index `user_volumes_upcoming_idx (user_id, release_date) WHERE
    // release_date IS NOT NULL` covers this exactly.
    let volumes = VolumeEntity::find()
        .filter(volume::Column::UserId.eq(user_id))
        .filter(volume::Column::ReleaseDate.is_not_null())
        .filter(volume::Column::ReleaseDate.gte(from))
        .filter(volume::Column::ReleaseDate.lte(until))
        .order_by_asc(volume::Column::ReleaseDate)
        .all(db)
        .await
        .map_err(AppError::from)?;

    if volumes.is_empty() {
        return Ok(Vec::new());
    }

    // Step 2: pull the series metadata in one IN-query, scoped to
    // this user (defense in depth — even if a volume row's mal_id
    // somehow points to another user's library, the user_id filter
    // here keeps the join authorisation-tight).
    let mal_ids: Vec<i32> = volumes
        .iter()
        .filter_map(|v| v.mal_id)
        .collect();
    let library_rows = if mal_ids.is_empty() {
        Vec::new()
    } else {
        LibraryEntity::find()
            .filter(library_mod::Column::UserId.eq(user_id))
            .filter(library_mod::Column::MalId.is_in(mal_ids.clone()))
            .all(db)
            .await
            .map_err(AppError::from)?
    };

    // Index by mal_id for the merge below.
    let library_by_mal: HashMap<i32, library_mod::Model> = library_rows
        .into_iter()
        .filter_map(|r| r.mal_id.map(|m| (m, r)))
        .collect();

    let mut out = Vec::with_capacity(volumes.len());
    for v in volumes {
        // Volumes with `release_date IS NOT NULL` always have a
        // mal_id in practice (custom-mal_id is < 0 but still set);
        // the filter below silently drops anything that slipped
        // through. ReleaseDate is non-null per the WHERE clause —
        // unwrap is safe.
        let Some(mal_id) = v.mal_id else { continue };
        let Some(release_date) = v.release_date else { continue };
        let Some(lib) = library_by_mal.get(&mal_id) else {
            // Library row was deleted out from under the volume —
            // the volume itself is an orphan (the cascading delete
            // from `delete_account` purges these, but a manual DROP
            // in a test DB might leak). Skip silently rather than
            // surfacing a half-formed card.
            continue;
        };
        // Genres on user_library are stored comma-separated. Match
        // the parsing helper in models::library::LibraryEntry to
        // avoid two divergent split implementations.
        let genres: Vec<String> = lib
            .genres
            .as_deref()
            .unwrap_or("")
            .split(',')
            .map(|g| g.trim().to_string())
            .filter(|g| !g.is_empty())
            .collect();

        out.push(CalendarEntry {
            id: v.id,
            mal_id,
            vol_num: v.vol_num,
            release_date,
            release_isbn: v.release_isbn,
            release_url: v.release_url,
            origin: v.origin,
            manga_name: lib.name.clone(),
            image_url_jpg: lib.image_url_jpg.clone(),
            genres,
        });
    }
    Ok(out)
}

/// 夜 · Distinct (mal_id, name) tuples present across every user's
/// library — the seed list for the nightly sweep.
///
/// Returns each pair exactly once even when many users follow the
/// same series. The MangaUpdates lookup runs against the title only
/// so we collapse on `(mal_id, name)` to dedupe — distinct mal_ids
/// with the same name (rare) still get separate lookups, which is
/// what we want.
pub async fn distinct_followed_series(
    db: &Db,
) -> Result<Vec<(i32, String)>, AppError> {
    use sea_orm::QuerySelect;
    // SeaORM's distinct + select_only pulls a tight `SELECT DISTINCT
    // mal_id, name FROM user_library` under the hood. Filter on
    // `mal_id > 0` so custom-entry rows (negative mal_id, no
    // MangaUpdates match possible) don't cost us a wasted API call.
    let rows: Vec<(Option<i32>, String)> = LibraryEntity::find()
        .select_only()
        .column(library_mod::Column::MalId)
        .column(library_mod::Column::Name)
        .filter(library_mod::Column::MalId.gt(0))
        .distinct()
        .into_tuple()
        .all(db)
        .await
        .map_err(AppError::from)?;

    Ok(rows
        .into_iter()
        .filter_map(|(mal, name)| mal.map(|m| (m, name)))
        .collect())
}

/// User ids that have a given series in their library. Drives the
/// per-user reconcile fan-out from the nightly sweep.
pub async fn user_ids_owning_series(
    db: &Db,
    mal_id: i32,
) -> Result<Vec<i32>, AppError> {
    use sea_orm::QuerySelect;
    let rows: Vec<i32> = LibraryEntity::find()
        .select_only()
        .column(library_mod::Column::UserId)
        .filter(library_mod::Column::MalId.eq(mal_id))
        .into_tuple()
        .all(db)
        .await
        .map_err(AppError::from)?;
    Ok(rows)
}

/// 廃 · Detect & purge cancelled / postponed-into-oblivion upcoming
/// rows.
///
/// Definition of "cancelled" here:
///   - `release_date IS NOT NULL` and was in the future when first
///     announced, BUT now lies more than `STALE_AFTER_DAYS` in the
///     past — the publisher's date came and went without the row
///     being marked owned.
///   - `origin != 'manual'` — the user didn't type the date in,
///     it came from an API source. A manually-entered upcoming
///     volume might be "I know it's coming Q4 2026 but no exact
///     date" and we shouldn't second-guess that.
///   - `owned = false` — if the user marked it owned (i.e. the tome
///     actually shipped and they got it), the row has graduated out
///     of the upcoming category. Don't touch.
///
/// Returns the number of rows removed for the caller to log. Run as
/// the first step of the nightly sweep so the rest of the discovery
/// pass operates on a clean slate.
const STALE_AFTER_DAYS: i64 = 14;
pub async fn purge_cancelled_upcoming(db: &Db) -> Result<u64, AppError> {
    let cutoff = Utc::now() - Duration::days(STALE_AFTER_DAYS);
    let res = VolumeEntity::delete_many()
        .filter(volume::Column::ReleaseDate.is_not_null())
        .filter(volume::Column::ReleaseDate.lt(cutoff))
        .filter(volume::Column::Origin.ne("manual"))
        .filter(volume::Column::Owned.eq(false))
        .exec(db)
        .await
        .map_err(AppError::from)?;
    Ok(res.rows_affected)
}
