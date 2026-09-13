use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};
use sea_orm::sea_query::{Expr, extension::postgres::PgExpr};

use crate::db::Db;
use crate::errors::AppError;
use crate::models::activity::event_types;
use crate::models::library::{
    self, ActiveModel, AddCustomRequest, AddFromMangadexRequest, AddLibraryRequest, AuthorRef,
    EDITION_MAX_LEN, Entity as LibraryEntity, LibraryEntry, PUBLISHER_MAX_LEN, REVIEW_MAX_LEN,
    UpdateLibraryRequest, entry_with_author, normalize_reading_status, sanitize_genres,
    sanitize_label,
};
use crate::models::volume::{self as volume_mod, Entity as VolumeEntity};
use crate::services::cache::CacheStore;
use crate::services::{activity, author, mangadex_api, settings, volume};
use crate::services::mal_api::get_manga_from_mal;

/// Upper bound on `volumes` for a single series, enforced at every
/// write path. Real manga cap out at ~200 tomes (One Piece is at
/// ~108 as of this writing); 10 000 is ~50× the longest known series
/// and gives plenty of headroom for obscure long-running works while
/// making DoS attacks (e.g. `{"volumes": 2_000_000_000}` → that many
/// INSERTs in one transaction) structurally impossible.
///
/// Applied at service-layer entry points, not in the INSERT loops
/// themselves, so existing persisted rows aren't retroactively
/// corrupted — but no new row can slip past the cap.
pub const MAX_VOLUMES_PER_SERIES: i32 = 10_000;

/// Clamp a user-supplied volume count to the safe range.
/// Negative values collapse to 0 (no volumes recorded), very large
/// values cap at [`MAX_VOLUMES_PER_SERIES`]. The clamp is silent — we
/// could return a 400 instead, but that would surprise legitimate
/// users with typos and the attack surface is an abuse vector, not a
/// UX one.
#[inline]
pub fn clamp_volumes(n: i32) -> i32 {
    n.clamp(0, MAX_VOLUMES_PER_SERIES)
}

/// `true` when the URL is an external HTTP(S) URL (MAL CDN, MangaDex
/// CDN, arbitrary http/https image host). `false` for anything else —
/// i.e. user-uploaded custom posters whose URL is a server-relative
/// path like `/api/user/storage/poster/{mal_id}`, or an unexpected
/// value we should treat defensively as "not external".
///
/// Replaces a previous `starts_with("http")` check that was fooled by
/// any string starting with those four letters (`"httpfoo"`,
/// `"http.example"`, etc.). Strict scheme prefixes eliminate the
/// ambiguity without introducing a full URL parse on every call.
#[inline]
pub fn is_external_http_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

// ─── Author enrichment ────────────────────────────────────────────
//
// Rust `From<Model>` for `LibraryEntry` produces `author: None`
// because it can't reach the DB. Listing endpoints rebuild the FK
// embed via these helpers so the SPA gets `{ author: { id, mal_id,
// name } }` directly off the response — same shape as the old
// `manga.author` text field, but with the FK target carried through
// for routing into the AuthorPage.

/// Build `LibraryEntry`s from `Model`s with one batched author
/// lookup. Cost is N+1 → 2 queries: one to load the rows (caller),
/// one to load the distinct authors, plus the in-memory join.
async fn enrich_with_authors(
    db: &Db,
    rows: Vec<library::Model>,
) -> Result<Vec<LibraryEntry>, AppError> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    // Collect distinct ids — a user with many series by the same
    // author shouldn't trigger duplicate fetches. Sorted for
    // deterministic logging when a query slow-logs.
    let mut ids: Vec<i32> = rows.iter().filter_map(|r| r.author_id).collect();
    ids.sort_unstable();
    ids.dedup();
    let lookup: std::collections::HashMap<i32, AuthorRef> =
        author::lookup_authors_by_ids(db, &ids).await?;
    Ok(rows
        .into_iter()
        .map(|r| entry_with_author(r, &lookup))
        .collect())
}

/// Single-row variant for add/update endpoints. Skips the lookup when
/// the row has no `author_id` (custom entries pre-edit, MAL series
/// before first refresh).
async fn enrich_one_with_author(
    db: &Db,
    row: library::Model,
) -> Result<LibraryEntry, AppError> {
    let Some(author_id) = row.author_id else {
        return Ok(LibraryEntry::from(row));
    };
    let lookup = author::lookup_authors_by_ids(db, &[author_id]).await?;
    Ok(entry_with_author(row, &lookup))
}

/// Produce the next negative mal_id for a user's custom entries.
///
/// Custom library entries (manually added, MangaDex-sourced, or copied
/// from another user's custom entry) use negative `mal_id` values to
/// keep them out of the MAL positive-id namespace. The next id is
/// `MIN(existing_negative) - 1`, or `-1` when the user has no custom
/// entries yet.
///
/// Concurrency note: two concurrent callers can both read the same
/// `MIN` and both compute the same next id. The partial unique index
/// `uniq_user_libraries_user_mal` (migration
/// 20260424160000_unique_library_volumes.sql) guarantees that only
/// one INSERT succeeds; the other gets a 23505 error which propagates
/// up as `AppError::Database`. That's acceptable — the user retries
/// their request and gets a fresh mint — and definitely safer than
/// silent data corruption from two rows sharing a negative id.
///
/// Overflow: the `checked_sub` defends against the (practically
/// impossible) case of 2.1 billion custom entries for one user. On
/// overflow we return an explicit Internal error rather than
/// wrapping around into the positive range.
/// Draw the next negative custom id from a Postgres sequence.
///
/// `nextval` is non-transactional and concurrency-safe: two callers (even
/// in different in-flight transactions) always get distinct values. This
/// replaced a `MIN(mal_id) - 1` probe-then-insert that raced — two
/// simultaneous mints computed the same id and the loser hit a 23505
/// (now a 409 that drops the edit). A value wasted on a rolled-back
/// transaction is a harmless gap. `seq` is a fixed `&'static str` literal
/// at both call sites (never user input), so the `format!` is
/// injection-safe.
pub(crate) async fn next_custom_id(
    conn: &impl ConnectionTrait,
    seq: &str,
) -> Result<i32, AppError> {
    let stmt = sea_orm::Statement::from_string(
        sea_orm::DatabaseBackend::Postgres,
        format!("SELECT nextval('{seq}')::bigint AS id"),
    );
    let row = conn
        .query_one(stmt)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Internal("sequence returned no row".into()))?;
    let next: i64 = row
        .try_get("", "id")
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(next as i32)
}

pub async fn mint_next_custom_mal_id(
    conn: &impl ConnectionTrait,
    _user_id: i32,
) -> Result<i32, AppError> {
    next_custom_id(conn, "custom_library_id_seq").await
}

/// Ask MangaDex for a better (uncensored, often higher-res) cover when the
/// series has adult tags. Returns `Some(new_url)` only when an upgrade is
/// found; otherwise `None` so callers keep the MAL fallback.
///
/// Skipped when:
///   - No adult genre present
///   - `mal_id` is None or ≤ 0 (custom entries with negative ids don't exist
///     on MangaDex)
///   - `current_url` points to a user-uploaded file (path starting with `/`
///     rather than `http`) — we never override a custom upload
async fn maybe_upgrade_cover_for_adult(
    client: &reqwest::Client,
    cache: Option<&CacheStore>,
    current_url: Option<&str>,
    genres: &[String],
    mal_id: Option<i32>,
    title_hint: &str,
) -> Option<String> {
    if !crate::services::genres::is_adult(genres) {
        return None;
    }
    let id = mal_id?;
    if id <= 0 {
        // custom entry — no mal_id to cross-reference
        return None;
    }
    if let Some(url) = current_url
        && !is_external_http_url(url) {
            // user-uploaded custom path — don't touch
            return None;
        }

    match mangadex_api::find_cover_url_by_mal_id(client, cache, id, title_hint).await {
        Ok(url) => url,
        Err(e) => {
            tracing::warn!(mal_id = id, error = %e, "cover-upgrade: MangaDex call failed");
            None
        }
    }
}

pub async fn get_user_library(db: &Db, user_id: i32) -> Result<Vec<LibraryEntry>, AppError> {
    let rows = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .all(db)
        .await
        .map_err(AppError::from)?;
    enrich_with_authors(db, rows).await
}

pub async fn get_user_manga(
    db: &Db,
    mal_id: i32,
    user_id: i32,
) -> Result<Vec<LibraryEntry>, AppError> {
    let rows = LibraryEntity::find()
        .filter(library::Column::MalId.eq(mal_id))
        .filter(library::Column::UserId.eq(user_id))
        .all(db)
        .await
        .map_err(AppError::from)?;
    enrich_with_authors(db, rows).await
}

pub async fn add_to_user_library(
    db: &Db,
    http_client: &reqwest::Client,
    cache: Option<&CacheStore>,
    activity_buffer: &crate::services::activity_coalescer::ActivityCoalescer,
    user_id: i32,
    req: AddLibraryRequest,
) -> Result<LibraryEntry, AppError> {
    let now = Utc::now();
    let genres_vec = req.genres.clone().unwrap_or_default();
    let genres_str = genres_vec.join(",");
    // Clamp before any downstream use: guards the `for 1..=volumes`
    // loop from DoS-sized inputs, and makes volumes_owned consistent
    // with the volumes ceiling (you can't own more than there are).
    let volumes = clamp_volumes(req.volumes);
    let volumes_owned = clamp_volumes(req.volumes_owned.unwrap_or(0)).min(volumes);
    let mal_id = req.mal_id;

    // Validate any incoming `mangadex_id` here as well, not just in
    // the dedicated `/library/mangadex` handler — generic POST
    // /library lets any caller stuff arbitrary bytes into this field
    // and they'd flow into a future `refresh_from_mangadex` outbound
    // request unchecked.
    if let Some(mdx) = req.mangadex_id.as_deref()
        && !crate::util::uuid::is_canonical_uuid(mdx)
    {
        return Err(AppError::BadRequest(
            "mangadex_id must be a canonical UUID".into(),
        ));
    }

    // For adult-tagged series, try to upgrade the cover to the MangaDex
    // (uncensored, typically higher-res) version before we store the URL.
    // Silently falls back to MAL's cover on any failure.
    let image_url_final = match maybe_upgrade_cover_for_adult(
        http_client,
        cache,
        req.image_url_jpg.as_deref(),
        &genres_vec,
        mal_id,
        &req.name,
    )
    .await
    {
        Some(new_url) => Some(new_url),
        None => crate::services::cover_pool::allowed_cover_url(req.image_url_jpg.as_deref()),
    };

    let txn = db.begin().await.map_err(AppError::from)?;

    // Idempotent upsert: if the user already has this mal_id, return the
    // existing row rather than erroring with a unique constraint violation.
    // This matters when the offline outbox replays an add op whose first
    // attempt already succeeded before losing the network.
    if let Some(m) = mal_id
        && let Some(existing) = LibraryEntity::find()
            .filter(library::Column::UserId.eq(user_id))
            .filter(library::Column::MalId.eq(m))
            .one(&txn)
            .await
            .map_err(AppError::from)?
        {
            txn.commit().await.map_err(AppError::from)?;
            return enrich_one_with_author(db, existing).await;
        }

    // Pre-sanitize the editorial metadata coming in from the request.
    // Trim + clamp + empty-to-None so the column never holds whitespace
    // or a runaway-length value. Same contract as the PATCH path.
    let publisher = sanitize_label(req.publisher, PUBLISHER_MAX_LEN);
    let edition = sanitize_label(req.edition, EDITION_MAX_LEN);

    // 作家 · Resolve an `authors.id` to stamp onto the new row.
    //
    // Three-step lookup:
    //   1. The request payload may carry `author_mal_id` directly
    //      (future-proof: the merged search endpoint could be
    //      extended to expose it). Use it if positive.
    //   2. Otherwise, when the entry has a positive series mal_id,
    //      fetch the MAL `/full` data via the cached
    //      `get_manga_from_mal` and pull the primary author's
    //      mal_id off `data.authors`. The MAL list-search endpoint
    //      doesn't include authors, so this extra fetch is the
    //      only way to wire authors at add time without a manual
    //      "refresh from MAL" round-trip.
    //   3. Otherwise, no author. The standard refresh path
    //      populates it later.
    //
    // Latency budget: step 2 adds ~200-1500 ms on cold MAL cache
    // (warm cache is ~5 ms via CacheStore). The user is already
    // in a "saving…" state — preferable to a multi-day gap before
    // they discover the author needs a manual refresh.
    let probed_author_mal_id: Option<i32> = match (req.author_mal_id, mal_id) {
        (Some(mid), _) if mid > 0 => Some(mid),
        (_, Some(series_mid)) if series_mid > 0 => {
            match get_manga_from_mal(http_client, cache, series_mid).await {
                Ok(Some(data)) => data
                    .authors
                    .as_ref()
                    .and_then(|list| list.iter().find(|a| !a.name.trim().is_empty()))
                    .and_then(|a| a.mal_id)
                    .filter(|id| *id > 0),
                _ => None,
            }
        }
        _ => None,
    };
    let resolved_author_id = match probed_author_mal_id {
        Some(mid) => author::find_or_create_shared_author_id(db, http_client, mid).await?,
        None => None,
    };

    let model = ActiveModel {
        created_on: Set(now),
        modified_on: Set(now),
        user_id: Set(user_id),
        mal_id: Set(mal_id),
        name: Set(req.name),
        volumes: Set(volumes),
        volumes_owned: Set(volumes_owned),
        image_url_jpg: Set(image_url_final),
        genres: Set(Some(genres_str)),
        mangadex_id: Set(req.mangadex_id.clone()),
        publisher: Set(publisher),
        edition: Set(edition),
        author_id: Set(resolved_author_id),
        ..Default::default()
    };

    let row = model.insert(&txn).await.map_err(AppError::from)?;

    // Create one volume row per volume
    for vol_num in 1..=volumes {
        volume::add_volume_tx(&txn, user_id, row.mal_id.unwrap_or(0), vol_num).await?;
    }

    // Capture row state we'll need after the txn commits before
    // it's moved into the response builder below.
    let added_mal_id = row.mal_id;
    let added_name = row.name.clone();

    txn.commit().await.map_err(AppError::from)?;

    // Activity log goes through the coalescer so a same-session
    // re-add (after a quick removal click) cancels the noise pair
    // instead of leaving both entries in the feed. Routed AFTER
    // commit because the buffer no longer rides on the txn — the
    // activity is fire-and-forget anyway, atomicity isn't required.
    activity_buffer
        .record(
            user_id,
            event_types::SERIES_ADDED,
            added_mal_id,
            None,
            Some(added_name),
            None,
        )
        .await;

    // Milestone check AFTER commit (uses fresh DB view)
    activity::check_series_milestone(db, user_id).await;

    // Author column is empty at add-time (we don't have MAL author
    // metadata in AddLibraryRequest); enrichment short-circuits to
    // the From<Model> path. The first MAL refresh populates the FK
    // and subsequent reads see the embedded AuthorRef.
    enrich_one_with_author(db, row).await
}

/// Add a library entry sourced from MangaDex. No MAL id exists, so we mint a
/// new negative mal_id (same scheme as pure-custom entries) and tag the row
/// with `mangadex_id` so "refresh from MangaDex" can operate on it later.
pub async fn add_from_mangadex(
    db: &Db,
    http_client: &reqwest::Client,
    cache: Option<&CacheStore>,
    activity_buffer: &crate::services::activity_coalescer::ActivityCoalescer,
    user_id: i32,
    req: AddFromMangadexRequest,
) -> Result<LibraryEntry, AppError> {
    // Idempotent: if the user already has this mangadex_id, return the row
    // rather than creating a duplicate with a new negative mal_id.
    if let Some(existing) = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MangadexId.eq(req.mangadex_id.clone()))
        .one(db)
        .await
        .map_err(AppError::from)?
    {
        return enrich_one_with_author(db, existing).await;
    }

    let new_mal_id = mint_next_custom_mal_id(db, user_id).await?;

    add_to_user_library(
        db,
        http_client,
        cache,
        activity_buffer,
        user_id,
        AddLibraryRequest {
            mal_id: Some(new_mal_id),
            name: req.name,
            volumes: req.volumes,
            volumes_owned: req.volumes_owned,
            image_url_jpg: req.image_url_jpg,
            genres: req.genres,
            mangadex_id: Some(req.mangadex_id),
            // MangaDex doesn't expose imprint metadata reliably, so we
            // leave these empty here. The user can fill them in later
            // from the series-detail edit form.
            publisher: None,
            edition: None,
            // 作家 · MangaDex search results don't carry MAL author
            // ids; the series gets its author on the next MAL refresh.
            author_mal_id: None,
        },
    )
    .await
}

/// Re-sync a library entry's name, genres and cover from MangaDex. Only
/// applies to rows that carry a `mangadex_id` (either pure-MangaDex entries
/// or MAL entries that were cross-linked at add time).
pub async fn refresh_from_mangadex(
    db: &Db,
    http_client: &reqwest::Client,
    cache: Option<&CacheStore>,
    user_id: i32,
    mal_id: i32,
) -> Result<(Vec<String>, String, Option<String>), AppError> {
    let row = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound("Library entry not found".into()))?;

    let mangadex_id = row
        .mangadex_id
        .clone()
        .ok_or_else(|| AppError::BadRequest("No MangaDex link on this entry".into()))?;

    let md_data = crate::services::mangadex_api::get_by_id(http_client, cache, &mangadex_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .ok_or_else(|| AppError::NotFound("MangaDex info not found".into()))?;

    let now = Utc::now();
    let genres_str = md_data.genres.join(",");

    // Preserve user-uploaded custom posters. Any URL that isn't
    // http(s)://… is treated as a local/path-like value we must not
    // override with a MangaDex CDN URL.
    let image_update = match row.image_url_jpg.as_deref() {
        Some(u) if !is_external_http_url(u) => row.image_url_jpg.clone(),
        _ => md_data.image_url.clone(),
    };

    let mut active: ActiveModel = row.into();
    active.genres = Set(Some(genres_str));
    active.name = Set(md_data.name.clone());
    active.image_url_jpg = Set(image_update.clone());
    active.modified_on = Set(now);
    active.update(db).await.map_err(AppError::from)?;

    Ok((md_data.genres, md_data.name, image_update))
}

/// Copy a user-uploaded poster blob from `src` to `dst` in the storage
/// backend, with a read-back verification step to catch silent failures.
///
/// Failure modes handled:
///   1. Source blob missing → return false, skip
///   2. Source blob empty (0 bytes) → return false, skip (don't
///      propagate a useless blob)
///   3. `put` returns Err → return false, skip
///   4. `put` returns Ok but verify read fails or returns empty bytes
///      → roll back the (potentially-broken) dst, return false
///
/// Why case 4 matters: the original bug report was a cover that went
/// missing right after a compare-import. In theory `put` returning Ok
/// should mean the object is durable on the next `get`. In practice,
/// MinIO upgrades mid-copy, bucket policy strippers, or a transient
/// endpoint issue can leave the caller with a success ACK and no
/// actual object. Without a verify step we'd record the custom-poster
/// URL in the library row and only discover the breakage on first
/// page load.
///
/// On any failure, we also `remove(dst)` so we don't leave a
/// half-written orphan. Caller should fall back to `None` in the
/// library row when this returns false — the UI will render the 巻
/// placeholder instead of a broken link.
async fn copy_poster_blob(
    storage: &dyn crate::storage::StorageBackend,
    src: &str,
    dst: &str,
) -> bool {
    let bytes = match storage.get(src).await {
        Ok(b) if b.is_empty() => {
            tracing::warn!(
                src = %src,
                "copy_poster: source blob is empty, skipping cover copy"
            );
            return false;
        }
        Ok(b) => b,
        Err(err) => {
            tracing::warn!(
                %err,
                src = %src,
                "copy_poster: source blob unreadable, skipping cover copy"
            );
            return false;
        }
    };
    let bytes_len = bytes.len();
    if let Err(err) = storage.put(dst, bytes).await {
        tracing::warn!(%err, dst = %dst, "copy_poster: put failed");
        return false;
    }
    // Verify round-trip. Also checks the size matches, so a partial
    // write (rare but possible under some S3 implementations) gets
    // caught here rather than becoming a silent data corruption.
    match storage.get(dst).await {
        Ok(v) if v.len() == bytes_len => {
            tracing::debug!(
                bytes = bytes_len,
                src = %src,
                dst = %dst,
                "copy_poster: copied + verified"
            );
            true
        }
        Ok(v) => {
            tracing::warn!(
                expected = bytes_len,
                actual = v.len(),
                dst = %dst,
                "copy_poster: verify read size mismatch, rolling back"
            );
            let _ = storage.remove(dst).await;
            false
        }
        Err(err) => {
            tracing::warn!(
                %err,
                dst = %dst,
                "copy_poster: verify read failed, rolling back"
            );
            let _ = storage.remove(dst).await;
            false
        }
    }
}

/// Copy a single series from another user's library into mine. Built
/// on top of `add_to_user_library` so we reuse the volume-row creation
/// and idempotent upsert logic. The wrinkle is the cover: when the
/// source entry has a custom upload (path-like URL, not http), we
/// copy the blob from their S3 path into mine under the new mal_id.
///
/// Behaviour by source entry type:
///   • MAL series (mal_id > 0)    → keep mal_id, keep image URL (CDN)
///   • MangaDex only              → mint new negative mal_id locally,
///                                  keep mangadex_id + image URL (CDN)
///   • Custom w/ external image   → mint new negative mal_id, keep URL
///   • Custom w/ manual upload    → mint new negative mal_id, copy
///                                  blob, stored URL becomes the
///                                  `/api/user/storage/poster/{new}` form
// 8 args, but 5 are ambient service handles (db, storage, http_client, cache,
// activity_buffer) rather than data — only the last 3 are real parameters.
// Collapsing the handles means threading a context/deps struct through this
// whole layer, which is an architecture change, not a lint cleanup. Exempted
// deliberately so the rest of the crate can stay clippy-clean.
#[allow(clippy::too_many_arguments)]
pub async fn copy_series_from_other_user(
    db: &Db,
    storage: &std::sync::Arc<dyn crate::storage::StorageBackend>,
    http_client: &reqwest::Client,
    cache: Option<&CacheStore>,
    activity_buffer: &crate::services::activity_coalescer::ActivityCoalescer,
    me_user_id: i32,
    other: &crate::models::user::User,
    source_mal_id: i32,
) -> Result<LibraryEntry, AppError> {
    let other_user_id = other.id;
    // Fetch source row from the other user's library.
    let source = LibraryEntity::find()
        .filter(library::Column::UserId.eq(other_user_id))
        .filter(library::Column::MalId.eq(source_mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound("Source series not found".into()))?;
    let source_entry = LibraryEntry::from(source.clone());

    // 公開 · Gate the copy through the SAME visibility predicate the
    // public profile + compare view use. Without it a caller could copy
    // (and thereby confirm the existence of) a series the owner hid — an
    // adult series with `public_show_adult=false`, or a wishlist entry
    // outside the Birthday-mode horizon. mal_ids are global/guessable,
    // so the copy POST was an ownership oracle for exactly the data the
    // opt-outs protect. Return the same NotFound the missing-row path
    // uses so the two are indistinguishable to the caller.
    let now = chrono::Utc::now();
    if !crate::services::users::entry_publicly_visible(other, &source_entry, now) {
        return Err(AppError::NotFound("Source series not found".into()));
    }

    // Figure out the mal_id I'll use locally. MAL series keep their
    // positive id; everything else mints a fresh negative id so the
    // custom-entry / uniqueness invariants hold.
    let is_mal = source_mal_id > 0;
    let target_mal_id = if is_mal {
        source_mal_id
    } else {
        mint_next_custom_mal_id(db, me_user_id).await?
    };

    // Decide the image URL I'll store. External URLs (MAL CDN /
    // MangaDex CDN) work for everyone, so we reuse them. A path-ish
    // URL means the source was a user upload — copy the blob.
    //
    // This is always a *copy*, never a move: the source user's blob
    // stays untouched, and we write a fresh object under a key keyed by
    // *my* user_id + target_mal_id. Two distinct S3 objects.
    let is_custom_upload = source_entry
        .image_url_jpg
        .as_deref()
        .map(|u| !is_external_http_url(u))
        .unwrap_or(false);
    let final_image_url = if is_custom_upload {
        let src_path = format!(
            "uploads/images/{}/{}.jpg",
            other_user_id, source_mal_id
        );
        let dst_path = format!(
            "uploads/images/{}/{}.jpg",
            me_user_id, target_mal_id
        );
        if copy_poster_blob(storage.as_ref(), &src_path, &dst_path).await {
            Some(format!("/api/user/storage/poster/{}", target_mal_id))
        } else {
            // Copy failed (missing/empty source, put error, verify
            // mismatch) — fall back to no cover. Better a 巻 placeholder
            // than a library row pointing at a blob that doesn't exist.
            None
        }
    } else {
        source_entry.image_url_jpg.clone()
    };

    // Delegate to add_to_user_library for the library row + per-volume
    // creation + milestone hooks. `volumes_owned=0` honours the spec:
    // user gets the series listed but marked as "unowned" so they can
    // check off what they actually have afterwards.
    add_to_user_library(
        db,
        http_client,
        cache,
        activity_buffer,
        me_user_id,
        AddLibraryRequest {
            mal_id: Some(target_mal_id),
            name: source_entry.name,
            volumes: source_entry.volumes,
            volumes_owned: Some(0),
            image_url_jpg: final_image_url,
            genres: if source_entry.genres.is_empty() {
                None
            } else {
                Some(source_entry.genres)
            },
            mangadex_id: source_entry.mangadex_id,
            // Don't carry the source user's publisher / edition over —
            // the destination user may collect a different imprint of
            // the same MAL series. Leaving these blank is the safer
            // default; they can be set later via the edit form.
            publisher: None,
            edition: None,
            // 作家 · Author copy across users is non-trivial: shared
            // MAL rows transfer cleanly via author_id, but custom
            // (per-user negative mal_id) authors don't. The next
            // `update_infos_from_mal` on the destination's row
            // populates author_id for shared MAL series; custom
            // entries stay author-less until the user edits them.
            author_mal_id: None,
        },
    )
    .await
}

pub async fn add_custom_entry(
    db: &Db,
    http_client: &reqwest::Client,
    cache: Option<&CacheStore>,
    activity_buffer: &crate::services::activity_coalescer::ActivityCoalescer,
    user_id: i32,
    req: AddCustomRequest,
) -> Result<LibraryEntry, AppError> {
    let new_mal_id = mint_next_custom_mal_id(db, user_id).await?;

    add_to_user_library(
        db,
        http_client,
        cache,
        activity_buffer,
        user_id,
        AddLibraryRequest {
            mal_id: Some(new_mal_id),
            name: req.name,
            volumes: req.volumes,
            volumes_owned: req.volumes_owned,
            image_url_jpg: None,
            genres: req.genres,
            mangadex_id: None,
            // Custom entries have no external metadata to mine; the
            // user fills in publisher / edition / author from the
            // edit form.
            publisher: None,
            edition: None,
            author_mal_id: None,
        },
    )
    .await
}

pub async fn delete_manga(
    db: &Db,
    activity_buffer: &crate::services::activity_coalescer::ActivityCoalescer,
    mal_id: i32,
    user_id: i32,
) -> Result<(), AppError> {
    // Capture the title before delete so the activity log can reference it
    let row = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?;
    let name = row.map(|r| r.name);

    let txn = db.begin().await.map_err(AppError::from)?;
    volume::delete_all_for_user_by_mal_id_tx(&txn, user_id, mal_id).await?;
    // 盒 · `coffrets.mal_id` carries no foreign key to the library, so
    // nothing cascades here. Left behind, the rows outlive the series and
    // reattach themselves the moment it is added back — a ghost box set
    // with the price and store of a series the user deleted. The archive
    // importer's replace path already deletes them; this is the same rule
    // on the same transaction.
    crate::models::coffret::Entity::delete_many()
        .filter(crate::models::coffret::Column::UserId.eq(user_id))
        .filter(crate::models::coffret::Column::MalId.eq(mal_id))
        .exec(&txn)
        .await
        .map_err(AppError::from)?;
    LibraryEntity::delete_many()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal_id))
        .exec(&txn)
        .await
        .map_err(AppError::from)?;

    txn.commit().await.map_err(AppError::from)?;

    // Activity log via the coalescer (post-commit). A user who
    // accidentally removes a series and re-adds within the buffer
    // window cancels both events instead of seeing a remove/add
    // noise pair in their feed.
    activity_buffer
        .record(
            user_id,
            event_types::SERIES_REMOVED,
            Some(mal_id),
            None,
            name,
            None,
        )
        .await;

    Ok(())
}

pub async fn get_total_volumes(
    db: &impl sea_orm::ConnectionTrait,
    mal_id: i32,
    user_id: i32,
) -> Result<Option<i32>, AppError> {
    let row = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?;
    Ok(row.map(|r| r.volumes))
}

/// Apply a partial update to a library row. Each field of the request
/// is honoured only when present:
///    - `volumes`   → routes to `update_manga_volumes` (which mutates
///      user_volumes alongside the count)
///    - `publisher` → trims, clamps, persists via ActiveModel
///    - `edition`   → same contract as publisher
///
/// All three may be sent in the same request; the volume mutation runs
/// first so the publisher / edition update can ride on the freshly
/// rebuilt row. Errors short-circuit — a malformed `volumes` won't let
/// the metadata fields slip through unsynced.
pub async fn apply_library_patch(
    db: &Db,
    mal_id: i32,
    user_id: i32,
    body: UpdateLibraryRequest,
) -> Result<(), AppError> {
    // 一 · One transaction for the WHOLE patch — the volume rebuild, the
    // metadata update, AND the free-text author resolution (which can
    // mint a new author row). Previously these were three independent
    // commits: if the volume rebuild committed and a later step then
    // errored, the client got a 500 while the volume change had already
    // persisted — and on replay re-applied it (the "edit applied 2-3×"
    // bug). Now any failure rolls the whole edit back: all-or-nothing.
    let txn = db.begin().await.map_err(AppError::from)?;

    if let Some(new_volumes) = body.volumes {
        update_manga_volumes_tx(&txn, mal_id, user_id, new_volumes).await?;
    }

    // publisher / edition / genres / review are independent of the volumes
    // path. Skip the round-trip when none of them are present (the common
    // case for a pure volumes PATCH) — but still commit the volume change.
    if body.publisher.is_none()
        && body.edition.is_none()
        && body.genres.is_none()
        && body.review.is_none()
        && body.review_public.is_none()
        && body.author.is_none()
        && body.reading_status.is_none()
        && body.started_reading_at.is_none()
        && body.finished_reading_at.is_none()
        && body.times_read.is_none()
    {
        txn.commit().await.map_err(AppError::from)?;
        return Ok(());
    }

    let row = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal_id))
        .one(&txn)
        .await
        .map_err(AppError::from)?;

    let Some(existing) = row else {
        // No row to update — silently OK (matches the volumes path's
        // behaviour). The client may have just deleted the series. Commit
        // so any volume change above still lands.
        txn.commit().await.map_err(AppError::from)?;
        return Ok(());
    };

    // 自由 · "Truly custom" gate for genre edits.
    //   mal_id < 0       → custom-minted id namespace, never collides with MAL
    //   mangadex_id None → no upstream MangaDex link to clobber on next sync
    // Both must hold. A row with positive mal_id (real MAL series) OR a
    // mangadex_id is excluded, because a future `refresh-from-*` would
    // otherwise silently undo the user's edits — without an
    // override-tracking schema (genres_added / genres_removed) we can't
    // merge the two safely.
    let custom_genres_allowed =
        existing.mal_id.is_some_and(|id| id < 0) && existing.mangadex_id.is_none();

    let mut active: ActiveModel = existing.into();

    // `Some(value)` means the client wants to set or clear the column.
    // sanitize_label folds `None`, `Some("")` and whitespace-only into
    // `None` (the "clear" outcome) and applies the length clamp.
    if let Some(raw) = body.publisher {
        active.publisher = Set(sanitize_label(raw, PUBLISHER_MAX_LEN));
    }
    if let Some(raw) = body.edition {
        active.edition = Set(sanitize_label(raw, EDITION_MAX_LEN));
    }
    if let Some(raw_genres) = body.genres
        && custom_genres_allowed {
            // `null` (Some(None)) and an empty list both clear the column.
            // A non-empty Vec runs through sanitize_genres for trim / dedup
            // / per-entry cap / count cap before being comma-joined.
            let cleaned = raw_genres
                .map(sanitize_genres)
                .unwrap_or_default();
            let stored = if cleaned.is_empty() {
                None
            } else {
                Some(cleaned.join(","))
            };
            active.genres = Set(stored);
        }
        // Non-custom rows: silently ignore. The frontend gates the UI on
        // the same condition, so this branch only runs for stale or
        // crafted requests; rejecting them with 4xx would be louder than
        // necessary.

    // 記憶 · Review text + visibility flag. Same trim/clamp/empty→None
    // contract as publisher/edition (sanitize_label). Visibility flag
    // is plain Option<bool> — no nested-Option needed since false is
    // a meaningful "make it private" signal, not "absence".
    if let Some(raw_review) = body.review {
        active.review = Set(sanitize_label(raw_review, REVIEW_MAX_LEN));
    }
    if let Some(public) = body.review_public {
        active.review_public = Set(public);
    }
    // 作家 · Author override. Free-text input from the manga edit
    // form is resolved via the FK pipeline:
    //   • Empty / null → clear author_id (unlink the byline)
    //   • Non-empty    → match against existing shared MAL or custom
    //     rows by name, or mint a new custom author if no match.
    // Available on every row (not gated to custom-only): even on a
    // MAL-linked series, the user can override "Hideo Kojima"
    // attribution if MAL's metadata is wrong. The next refresh from
    // MAL only re-writes when the FK is empty, so the override
    // sticks across syncs.
    if let Some(raw_author) = body.author {
        let resolved_id = match raw_author {
            Some(text) => {
                author::resolve_author_from_text_tx(&txn, user_id, &text).await?
            }
            None => None,
        };
        active.author_id = Set(resolved_id);
    }
    // 読 · Reading progression, set by hand. A validated status; dates
    // as given (clearing allowed); the read-through count never below 0.
    // Marking a series completed by hand stamps today as the finish date
    // when none is set, so the shelf's history stays populated.
    if let Some(raw_status) = body.reading_status {
        let status = normalize_reading_status(raw_status)?;
        if status.as_deref() == Some("completed")
            && body.finished_reading_at.is_none()
            && let sea_orm::ActiveValue::Unchanged(None) = active.finished_reading_at
        {
            active.finished_reading_at = Set(Some(Utc::now().date_naive()));
        }
        active.reading_status = Set(status);
    }
    if let Some(date) = body.started_reading_at {
        active.started_reading_at = Set(date);
    }
    if let Some(date) = body.finished_reading_at {
        active.finished_reading_at = Set(date);
    }
    if let Some(n) = body.times_read {
        active.times_read = Set(n.max(0));
    }

    active.modified_on = Set(Utc::now());
    active.update(&txn).await.map_err(AppError::from)?;
    txn.commit().await.map_err(AppError::from)?;
    Ok(())
}

pub async fn update_manga_volumes(
    db: &Db,
    mal_id: i32,
    user_id: i32,
    new_volumes: i32,
) -> Result<(), AppError> {
    // Standalone wrapper: own transaction for callers not already inside
    // one (e.g. the MAL-refresh path). `apply_library_patch` calls the
    // `_tx` variant directly so the volume rebuild + metadata update +
    // author resolution all share ONE transaction.
    let txn = db.begin().await.map_err(AppError::from)?;
    update_manga_volumes_tx(&txn, mal_id, user_id, new_volumes).await?;
    txn.commit().await.map_err(AppError::from)?;
    Ok(())
}

pub async fn update_manga_volumes_tx(
    conn: &impl sea_orm::ConnectionTrait,
    mal_id: i32,
    user_id: i32,
    new_volumes: i32,
) -> Result<(), AppError> {
    // Clamp at the entry point — a PATCH with `volumes: 2_000_000_000`
    // would otherwise fire 2 billion per-volume INSERTs (one row per
    // tick of the loop below) in one request and exhaust disk/memory.
    let new_volumes = clamp_volumes(new_volumes);
    let old_total = get_total_volumes(conn, mal_id, user_id).await?.unwrap_or(0);

    if old_total == new_volumes {
        return Ok(());
    }

    // Every per-volume INSERT/DELETE plus the library row update runs on
    // the caller's connection. The standalone wrapper above provides a
    // transaction so a failure mid-loop never leaves the library row's
    // `volumes` count out of sync with the actual `user_volumes` rows
    // (dashboard rendering N while the shelf has N-K). Atomic: every
    // change lands or none.
    if old_total > new_volumes {
        for vol_num in (new_volumes + 1)..=old_total {
            volume::remove_volume_by_num_tx(conn, user_id, mal_id, vol_num).await?;
        }
    } else {
        for vol_num in (old_total + 1)..=new_volumes {
            volume::add_volume_tx(conn, user_id, mal_id, vol_num).await?;
        }
    }

    let now = Utc::now();
    let row = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal_id))
        .one(conn)
        .await
        .map_err(AppError::from)?;

    if let Some(existing) = row {
        // 冊 · The rows above `new_volumes` were just deleted, so an
        // owned count that still counts them is a lie the whole app
        // reads: "12 / 5" on the card, a completion ring clamped to
        // 100 %, a series counted as complete for its seal, and a
        // collection total that is permanently too high. Nothing
        // recomputes it on the per-volume path, so it has to be
        // clamped here — including on the MAL refresh, which shrinks
        // totals without the user doing anything.
        let owned = existing.volumes_owned.min(new_volumes);
        let mut active: ActiveModel = existing.into();
        active.volumes = Set(new_volumes);
        active.volumes_owned = Set(owned);
        active.modified_on = Set(now);
        active.update(conn).await.map_err(AppError::from)?;
    }

    Ok(())
}

pub async fn update_volumes_owned(
    db: &Db,
    user_id: i32,
    mal_id: i32,
    volumes_owned: i32,
) -> Result<(), AppError> {
    let now = Utc::now();
    let row = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?;

    if let Some(existing) = row {
        let previous_owned = existing.volumes_owned;
        let total_volumes = existing.volumes;
        let name = existing.name.clone();
        // Clamp so the persisted `volumes_owned` is always in
        // [0, total_volumes]. Prevents dashboards from rendering "12/8
        // volumes" when a client sends a stale or malformed value.
        // Consistent with the clamp in `add_to_user_library` and the
        // `owned_up_to` clamp in the archive importer.
        let volumes_owned = volumes_owned.clamp(0, total_volumes);

        let mut active: ActiveModel = existing.into();
        active.volumes_owned = Set(volumes_owned);
        active.modified_on = Set(now);
        active.update(db).await.map_err(AppError::from)?;

        // Completion milestone — emit once when the series flips to full
        if total_volumes > 0
            && previous_owned < total_volumes
            && volumes_owned >= total_volumes
        {
            activity::record(
                db,
                user_id,
                event_types::SERIES_COMPLETED,
                Some(mal_id),
                None,
                Some(name),
                Some(total_volumes),
            )
            .await;
        }

        // Cross-library volume milestones (50, 100, 250, …)
        activity::check_volume_milestone(db, user_id).await;
    }

    Ok(())
}

pub async fn change_poster(
    db: &Db,
    user_id: i32,
    mal_id: i32,
    new_poster_path: Option<String>,
) -> Result<(), AppError> {
    let now = Utc::now();
    let row = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?;

    if let Some(existing) = row {
        let mut active: ActiveModel = existing.into();
        active.image_url_jpg = Set(new_poster_path);
        active.modified_on = Set(now);
        active.update(db).await.map_err(AppError::from)?;
    }

    Ok(())
}

/// Escape SQL `LIKE`/`ILIKE` wildcards (`\`, `%`, `_`) so a value is
/// matched literally. Relies on Postgres' default `\` escape char.
/// Wrap the result in your own `%…%` for a contains-match, or use it
/// bare for a wildcard-free (literal) `ILIKE` equality.
pub(crate) fn escape_like(s: &str) -> String {
    s.chars()
        .flat_map(|c| match c {
            '\\' | '%' | '_' => vec!['\\', c],
            other => vec![other],
        })
        .collect()
}

pub async fn search(
    db: &Db,
    user_id: i32,
    query: &str,
) -> Result<Vec<LibraryEntry>, AppError> {
    // Escape LIKE wildcards before wrapping with our own `%...%`.
    // Without this, a user searching for `100%` matches every row
    // (the `%` they typed is treated as the SQL wildcard); `foo_bar`
    // matches any character in the middle slot. Not a SQL injection
    // (arguments are still parameterised by sea-orm/sqlx), but a
    // surprising search UX and a light-weight information leak.
    //
    // Standard pattern: escape `\`, `%`, `_` with a preceding `\`, and
    // rely on Postgres' LIKE default escape char (also `\`).
    let pattern = format!("%{}%", escape_like(&query.to_lowercase()));
    let rows = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(Expr::col(library::Column::Name).ilike(pattern))
        .all(db)
        .await
        .map_err(AppError::from)?;
    enrich_with_authors(db, rows).await
}

pub async fn update_infos_from_mal(
    db: &Db,
    http_client: &reqwest::Client,
    cache: Option<&CacheStore>,
    user_id: i32,
    mal_id: i32,
) -> Result<(Vec<String>, String), AppError> {
    let mal_data = get_manga_from_mal(http_client, cache, mal_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .ok_or_else(|| AppError::NotFound("MAL info not found".into()))?;

    // Collect genres from genres + demographics + explicit_genres (type == "manga")
    let genres: Vec<String> = mal_data
        .genres
        .iter()
        .flatten()
        .chain(mal_data.demographics.iter().flatten())
        .chain(mal_data.explicit_genres.iter().flatten())
        .filter(|g| g.genre_type == "manga")
        .map(|g| g.name.clone())
        .collect();

    // Determine title based on user's titleType setting
    let user_settings = settings::get_user_settings(db, user_id).await?;
    let title_type = user_settings.title_type.as_deref().unwrap_or("Default");

    let resolved_name = mal_data
        .titles
        .iter()
        .flatten()
        .find(|t| t.title_type == title_type)
        .map(|t| t.title.clone())
        .or_else(|| mal_data.title.clone())
        .unwrap_or_default();

    // 作家 · MAL ships authors as "Family, Given" (Japanese convention).
    // Flip to Western "Given Family" so the resolver does its name
    // lookup against the canonical form the rest of the app uses.
    //
    // The first non-empty author wins on collaborations — see the
    // MalAuthor docstring on why we don't try to capture co-authors
    // in v1.
    let primary_author = mal_data
        .authors
        .as_ref()
        .and_then(|list| list.iter().find(|a| !a.name.trim().is_empty()));
    let resolved_author_mal_id: Option<i32> =
        primary_author.and_then(|a| a.mal_id).filter(|id| *id > 0);
    // Resolve the FK target up-front so each library row's update
    // can write a uniform author_id. With a positive MAL author id
    // we go through the shared cache (Jikan fetch on cold miss);
    // without one but with a typed name, we fall back to the
    // free-text resolver (find-or-create custom). On both lookup
    // and fetch failures the FK stays None — the user can retry the
    // refresh later.
    let resolved_author_id: Option<i32> = if let Some(mid) = resolved_author_mal_id {
        author::find_or_create_shared_author_id(db, http_client, mid).await?
    } else if let Some(a) = primary_author {
        let flipped = flip_author_name(&a.name);
        author::resolve_author_from_text(db, user_id, &flipped).await?
    } else {
        None
    };

    // Fetch the library rows for this user+manga and update them
    let rows = LibraryEntity::find()
        .filter(library::Column::MalId.eq(mal_id))
        .filter(library::Column::UserId.eq(user_id))
        .all(db)
        .await
        .map_err(AppError::from)?;

    for row in rows {
        // Update volumes if MAL has a different count
        if let Some(mal_volumes) = mal_data.volumes
            && row.volumes != mal_volumes {
                update_manga_volumes(db, mal_id, user_id, mal_volumes).await?;
            }

        let now = Utc::now();
        // Only overwrite image if no custom poster set
        let mut image_update = if row.image_url_jpg.is_none() {
            mal_data
                .images
                .as_ref()
                .and_then(|i| i.jpg.as_ref())
                .and_then(|j| j.image_url.clone())
        } else {
            row.image_url_jpg.clone()
        };

        // Adult series → prefer the uncensored MangaDex cover. Honours any
        // existing user-uploaded poster (skipped inside the helper).
        if let Some(new_url) = maybe_upgrade_cover_for_adult(
            http_client,
            cache,
            image_update.as_deref(),
            &genres,
            Some(mal_id),
            &resolved_name,
        )
        .await
        {
            image_update = Some(new_url);
        }

        let prior_author_id = row.author_id;
        let mut active: ActiveModel = row.into();
        active.genres = Set(Some(genres.join(",")));
        active.name = Set(resolved_name.clone());
        active.image_url_jpg = Set(image_update);
        // 作家 · Honour user overrides — only write author_id when
        // MAL surfaced one AND the FK is currently empty. A user who
        // typed their own author credit on a Japanese-original work
        // shouldn't have it clobbered by a re-fetch from MAL. The
        // edit form is the authoritative path once the user touches
        // the field.
        if prior_author_id.is_none() && resolved_author_id.is_some() {
            active.author_id = Set(resolved_author_id);
        }
        active.modified_on = Set(now);
        active.update(db).await.map_err(AppError::from)?;
    }

    Ok((genres, resolved_name))
}

/// "Family, Given" → "Given Family". MAL/Jikan ships Japanese authors
/// in Family-Given order with a comma separator; UI elsewhere renders
/// Western order, so we flip on persistence to keep the rendering
/// layer comma-free. Names without a comma are returned untouched.
fn flip_author_name(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some((family, given)) = trimmed.split_once(',') {
        let family = family.trim();
        let given = given.trim();
        if !family.is_empty() && !given.is_empty() {
            return format!("{} {}", given, family);
        }
    }
    trimmed.to_string()
}

/* ══════════════════════════════════════════════════════════════════
 *  読 · Reading progression — derived from the volume rows, overridable.
 * ══════════════════════════════════════════════════════════════════ */

/// The series-level reading fields, as a plain value the pure rule below
/// can reason about without a database.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadingState {
    pub status: Option<String>,
    pub started: Option<chrono::NaiveDate>,
    pub finished: Option<chrono::NaiveDate>,
}

/// What the series' reading state should become once `read_count` of
/// its `total` tracked volumes are read, on `today`.
///
///   • every tracked tome read (total known) → `completed`, dates filled
///     if missing — the finish date is never overwritten;
///   • some read → `reading`, unless the user parked the series as
///     `paused` or `dropped` (their call stands); a `completed` series
///     with a tome un-read goes back to `reading` and loses its finish;
///   • nothing read → `reading`/`completed` become "never started" and
///     the dates go with them; `planned`/`paused`/`dropped` stand.
pub fn next_reading_state(
    current: &ReadingState,
    read_count: i32,
    total: i32,
    today: chrono::NaiveDate,
) -> ReadingState {
    let status = current.status.as_deref();
    let parked = matches!(status, Some("paused") | Some("dropped"));
    if read_count <= 0 {
        return if matches!(status, Some("reading") | Some("completed")) {
            ReadingState {
                status: None,
                started: None,
                finished: None,
            }
        } else {
            current.clone()
        };
    }
    let started = current.started.or(Some(today));
    if total > 0 && read_count >= total {
        return ReadingState {
            status: Some("completed".into()),
            started,
            finished: current.finished.or(Some(today)),
        };
    }
    if parked {
        return ReadingState {
            started,
            ..current.clone()
        };
    }
    ReadingState {
        status: Some("reading".into()),
        started,
        finished: None,
    }
}

/// Recompute the reading progression of one series from its volume
/// rows and persist it when it moved. Returns whether the library row
/// changed, so the caller can fan out a `Library` realtime event.
pub async fn refresh_reading_progress(
    db: &impl sea_orm::ConnectionTrait,
    user_id: i32,
    mal_id: i32,
) -> Result<bool, AppError> {
    use sea_orm::PaginatorTrait;
    let Some(row) = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?
    else {
        return Ok(false);
    };
    let read_count = VolumeEntity::find()
        .filter(volume_mod::Column::UserId.eq(user_id))
        .filter(volume_mod::Column::MalId.eq(mal_id))
        .filter(volume_mod::Column::ReadAt.is_not_null())
        .count(db)
        .await
        .map_err(AppError::from)? as i32;
    let current = ReadingState {
        status: row.reading_status.clone(),
        started: row.started_reading_at,
        finished: row.finished_reading_at,
    };
    let next = next_reading_state(&current, read_count, row.volumes, Utc::now().date_naive());
    if next == current {
        return Ok(false);
    }
    let mut active: ActiveModel = row.into();
    active.reading_status = Set(next.status);
    active.started_reading_at = Set(next.started);
    active.finished_reading_at = Set(next.finished);
    active.modified_on = Set(Utc::now());
    active.update(db).await.map_err(AppError::from)?;
    Ok(true)
}

/// 再読 · Start reading the series again: one more read-through on the
/// tally, every released tome back to unread so the emaki starts over,
/// status `reading` from today. Only meaningful once the series has
/// been finished at least once (or has read tomes to reset).
pub async fn start_reread(db: &Db, user_id: i32, mal_id: i32) -> Result<(), AppError> {
    use sea_orm::{Condition, PaginatorTrait, sea_query::Expr};
    let now = Utc::now();
    let Some(row) = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?
    else {
        return Err(AppError::NotFound("Series not in library".into()));
    };
    let read_count = VolumeEntity::find()
        .filter(volume_mod::Column::UserId.eq(user_id))
        .filter(volume_mod::Column::MalId.eq(mal_id))
        .filter(volume_mod::Column::ReadAt.is_not_null())
        .count(db)
        .await
        .map_err(AppError::from)?;
    let finished_once =
        row.reading_status.as_deref() == Some("completed") || row.finished_reading_at.is_some();
    if !finished_once && read_count == 0 {
        return Err(AppError::BadRequest(
            "Nothing to read again yet — finish the series first.".into(),
        ));
    }
    let txn = db.begin().await.map_err(AppError::from)?;
    VolumeEntity::update_many()
        .filter(volume_mod::Column::UserId.eq(user_id))
        .filter(volume_mod::Column::MalId.eq(mal_id))
        .filter(
            Condition::any()
                .add(volume_mod::Column::ReleaseDate.is_null())
                .add(volume_mod::Column::ReleaseDate.lte(now)),
        )
        .col_expr(
            volume_mod::Column::ReadAt,
            Expr::value(Option::<chrono::DateTime<Utc>>::None),
        )
        .col_expr(volume_mod::Column::ModifiedOn, Expr::value(now))
        .exec(&txn)
        .await
        .map_err(AppError::from)?;
    let series_name = row.name.clone();
    let times = row.times_read;
    let mut active: ActiveModel = row.into();
    // A finished read-through counts even when the user never flipped
    // the last tome to read; an unfinished one is a restart, not a lap.
    active.times_read = Set(if finished_once { times + 1 } else { times });
    active.reading_status = Set(Some("reading".into()));
    active.started_reading_at = Set(Some(now.date_naive()));
    active.finished_reading_at = Set(None);
    active.modified_on = Set(now);
    active.update(&txn).await.map_err(AppError::from)?;
    txn.commit().await.map_err(AppError::from)?;
    if finished_once {
        activity::record(
            db,
            user_id,
            event_types::SERIES_REREAD,
            Some(mal_id),
            None,
            Some(series_name),
            Some(times + 1),
        )
        .await;
    }
    Ok(())
}

#[cfg(test)]
mod reading_tests {
    use super::*;

    fn d(s: &str) -> chrono::NaiveDate {
        chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }
    fn st(status: Option<&str>, started: Option<&str>, finished: Option<&str>) -> ReadingState {
        ReadingState {
            status: status.map(String::from),
            started: started.map(d),
            finished: finished.map(d),
        }
    }
    const TODAY: &str = "2026-09-13";

    #[test]
    fn first_read_tome_starts_the_series_today() {
        let next = next_reading_state(&st(None, None, None), 1, 12, d(TODAY));
        assert_eq!(next, st(Some("reading"), Some(TODAY), None));
    }

    #[test]
    fn last_tome_completes_and_keeps_the_original_start() {
        let next = next_reading_state(
            &st(Some("reading"), Some("2025-01-05"), None),
            12,
            12,
            d(TODAY),
        );
        assert_eq!(next, st(Some("completed"), Some("2025-01-05"), Some(TODAY)));
    }

    #[test]
    fn an_existing_finish_date_is_never_overwritten() {
        let cur = st(Some("completed"), Some("2025-01-05"), Some("2025-06-01"));
        assert_eq!(next_reading_state(&cur, 12, 12, d(TODAY)), cur);
    }

    #[test]
    fn unreading_a_tome_of_a_completed_series_reopens_it() {
        let cur = st(Some("completed"), Some("2025-01-05"), Some("2025-06-01"));
        assert_eq!(
            next_reading_state(&cur, 11, 12, d(TODAY)),
            st(Some("reading"), Some("2025-01-05"), None)
        );
    }

    #[test]
    fn unknown_total_never_completes() {
        let next = next_reading_state(&st(None, None, None), 40, 0, d(TODAY));
        assert_eq!(next.status.as_deref(), Some("reading"));
    }

    #[test]
    fn paused_and_dropped_stand_while_tomes_are_read() {
        for parked in ["paused", "dropped"] {
            let cur = st(Some(parked), Some("2025-01-05"), None);
            assert_eq!(next_reading_state(&cur, 3, 12, d(TODAY)), cur);
            // …until every tome is read: that is a completion whatever the label
            assert_eq!(
                next_reading_state(&cur, 12, 12, d(TODAY)).status.as_deref(),
                Some("completed")
            );
        }
    }

    #[test]
    fn unreading_everything_returns_to_never_started_but_keeps_a_plan() {
        assert_eq!(
            next_reading_state(
                &st(Some("reading"), Some("2025-01-05"), None),
                0,
                12,
                d(TODAY)
            ),
            st(None, None, None)
        );
        let planned = st(Some("planned"), None, None);
        assert_eq!(next_reading_state(&planned, 0, 12, d(TODAY)), planned);
    }
}
