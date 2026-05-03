//! 作家 · Author detail service.
//!
//! Two responsibility groups:
//!
//!   1. SHARED MAL CACHE — `get_or_fetch_author(db, http, user_id, mal_id)`
//!      with `mal_id > 0`. Cache-aside over Jikan's
//!      `/people/{mal_id}/full`. Rows live in `authors WHERE
//!      user_id IS NULL`, written once per real author and shared
//!      by every user. Stale rows (>7d) revalidate in background.
//!
//!   2. CUSTOM AUTHOR CRUD — `create_custom_author`, `update_custom_author`,
//!      `delete_author`, `set_custom_photo`. Operates on rows where
//!      `user_id = caller`. The mal_id is minted negative per-user
//!      so each user has their own custom namespace without
//!      colliding with anyone else's.
//!
//! Lookup contract (`get_or_fetch_author`):
//!   • Positive mal_id → resolve against `authors WHERE user_id IS
//!     NULL AND mal_id = X`. Cold cache triggers Jikan fetch.
//!   • Negative mal_id → resolve against `authors WHERE user_id =
//!     caller AND mal_id = X`. Never hits Jikan; missing → None.

use std::time::Duration;

use chrono::{DateTime, TimeZone, Utc};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QuerySelect, Set, TransactionTrait,
    sea_query::{Expr, extension::postgres::PgExpr},
};
use serde::Deserialize;

use crate::db::Db;
use crate::errors::AppError;
use crate::util::url::build_url;
use crate::models::author::{
    self, AUTHOR_ABOUT_MAX_LEN, AUTHOR_NAME_MAX_LEN, ActiveModel, AuthorDetail,
    Entity as AuthorEntity,
};
use crate::models::library::{self, AuthorRef, Entity as LibraryEntity};

/// Records older than this are revalidated against Jikan on next
/// access. 7 days strikes a reasonable balance between "fresh enough
/// for biographical changes" (which are rare) and "doesn't hammer
/// Jikan's rate limit when a popular author's page sees lots of
/// traffic".
const STALE_AFTER: Duration = Duration::from_secs(7 * 24 * 3600);

/// Per-request timeout when calling Jikan. The page renders the
/// fallback (cached or empty) on any error.
const FETCH_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Deserialize)]
struct JikanPersonResponse {
    data: Option<JikanPersonData>,
}

#[derive(Debug, Deserialize)]
struct JikanPersonData {
    mal_id: i32,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    images: Option<JikanPersonImages>,
    name: String,
    #[serde(default)]
    given_name: Option<String>,
    #[serde(default)]
    family_name: Option<String>,
    #[serde(default)]
    birthday: Option<String>,
    #[serde(default)]
    favorites: Option<i32>,
    #[serde(default)]
    about: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JikanPersonImages {
    #[serde(default)]
    jpg: Option<JikanPersonImageUrls>,
}

#[derive(Debug, Deserialize)]
struct JikanPersonImageUrls {
    #[serde(default)]
    image_url: Option<String>,
}

/// Resolve an author detail. Routes to the shared MAL cache path
/// (positive mal_id) or the custom-author lookup (negative mal_id).
pub async fn get_or_fetch_author(
    db: &Db,
    http: &reqwest::Client,
    caller_user_id: i32,
    mal_id: i32,
) -> Result<Option<AuthorDetail>, AppError> {
    if mal_id > 0 {
        get_or_fetch_shared(db, http, mal_id).await
    } else if mal_id < 0 {
        get_custom(db, caller_user_id, mal_id).await
    } else {
        Ok(None)
    }
}

async fn get_or_fetch_shared(
    db: &Db,
    http: &reqwest::Client,
    mal_id: i32,
) -> Result<Option<AuthorDetail>, AppError> {
    let cached = AuthorEntity::find()
        .filter(author::Column::UserId.is_null())
        .filter(author::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?;

    if let Some(row) = cached {
        let age = (Utc::now() - row.fetched_at).to_std().unwrap_or(STALE_AFTER);
        if age < STALE_AFTER {
            return Ok(Some(row.into()));
        }
        let detail: AuthorDetail = row.clone().into();
        let db_clone = db.clone();
        let http_clone = http.clone();
        tokio::spawn(async move {
            if let Err(err) = fetch_and_upsert_shared(&db_clone, &http_clone, mal_id).await {
                tracing::warn!(
                    mal_id,
                    %err,
                    "author cache: background revalidate failed",
                );
            }
        });
        return Ok(Some(detail));
    }

    fetch_and_upsert_shared(db, http, mal_id).await
}

async fn get_custom(
    db: &Db,
    caller_user_id: i32,
    mal_id: i32,
) -> Result<Option<AuthorDetail>, AppError> {
    let row = AuthorEntity::find()
        .filter(author::Column::UserId.eq(caller_user_id))
        .filter(author::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?;
    Ok(row.map(AuthorDetail::from))
}

/// Force a fresh Jikan fetch for a shared MAL author, bypassing the
/// 7-day staleness gate. Wired to the Refresh button on the author
/// page; rejects negative mal_ids (custom authors have no upstream
/// source to refresh from). Updates the cached row in-place and
/// returns the new detail.
pub async fn refresh_shared_author(
    db: &Db,
    http: &reqwest::Client,
    mal_id: i32,
) -> Result<Option<AuthorDetail>, AppError> {
    if mal_id <= 0 {
        return Err(AppError::BadRequest(
            "Only shared MAL authors can be refreshed.".into(),
        ));
    }
    fetch_and_upsert_shared(db, http, mal_id).await
}

async fn fetch_and_upsert_shared(
    db: &Db,
    http: &reqwest::Client,
    mal_id: i32,
) -> Result<Option<AuthorDetail>, AppError> {
    // 安 · URL constructed via `Url::path_segments_mut` so CodeQL's
    // request-forgery taint analysis sees the sanitizer (i32 Display
    // only emits digits, but the builder is defence in depth).
    let url = build_url(
        "https://api.jikan.moe/v4/people",
        &[&mal_id.to_string(), "full"],
    )?;
    let resp = http
        .get(url)
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
        .map_err(|e| AppError::BadRequest(format!("Jikan author fetch failed: {e}")))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(AppError::BadRequest(format!(
            "Jikan returned {}",
            resp.status()
        )));
    }

    let body: JikanPersonResponse = resp
        .json()
        .await
        .map_err(|e| AppError::BadRequest(format!("Jikan author parse error: {e}")))?;
    let Some(data) = body.data else {
        return Ok(None);
    };

    let image_url = data
        .images
        .and_then(|i| i.jpg)
        .and_then(|j| j.image_url);
    let birthday = data.birthday.as_deref().and_then(parse_birthday);
    let now = Utc::now();

    // Look up an existing shared row to preserve its synthetic id.
    // Without this, the upsert would conflict on the partial unique
    // index `(mal_id) WHERE user_id IS NULL` and SeaORM would
    // surface a confusing 500 instead of updating-in-place.
    let existing_id = AuthorEntity::find()
        .filter(author::Column::UserId.is_null())
        .filter(author::Column::MalId.eq(mal_id))
        .select_only()
        .column(author::Column::Id)
        .into_tuple::<i32>()
        .one(db)
        .await
        .map_err(AppError::from)?;

    let mut model = ActiveModel {
        user_id: Set(None),
        mal_id: Set(data.mal_id),
        name: Set(data.name.clone()),
        given_name: Set(data.given_name),
        family_name: Set(data.family_name),
        image_url: Set(image_url),
        about: Set(data.about),
        birthday: Set(birthday),
        favorites: Set(data.favorites.unwrap_or(0)),
        mal_url: Set(data.url),
        fetched_at: Set(now),
        ..Default::default()
    };
    if let Some(id) = existing_id {
        model.id = Set(id);
        model.update(db).await.map_err(AppError::from)?;
    } else {
        model.insert(db).await.map_err(AppError::from)?;
    }

    let row = AuthorEntity::find()
        .filter(author::Column::UserId.is_null())
        .filter(author::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?;
    Ok(row.map(AuthorDetail::from))
}

// ─── Custom author CRUD ────────────────────────────────────────────

/// Trim + length-clamp + empty-to-None for the user-typed bio. Same
/// contract as `sanitize_label` in `models::library`.
fn sanitize_about(value: Option<String>) -> Option<String> {
    let v = value?.trim().to_string();
    if v.is_empty() {
        return None;
    }
    Some(v.chars().take(AUTHOR_ABOUT_MAX_LEN).collect())
}

fn sanitize_name(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("Author name is required.".into()));
    }
    Ok(trimmed.chars().take(AUTHOR_NAME_MAX_LEN).collect())
}

/// Mint the next negative mal_id for this user's custom-authors
/// namespace. Mirrors the `mint_next_custom_mal_id` pattern used for
/// custom library entries — `MIN(mal_id) - 1` per user, falling back
/// to `-1` when the user has no custom authors yet.
async fn mint_next_custom_author_id(
    db: &impl sea_orm::ConnectionTrait,
    user_id: i32,
) -> Result<i32, AppError> {
    let min_existing: Option<i32> = AuthorEntity::find()
        .select_only()
        .column_as(Expr::col(author::Column::MalId).min(), "min")
        .filter(author::Column::UserId.eq(user_id))
        .filter(author::Column::MalId.lt(0))
        .into_tuple::<Option<i32>>()
        .one(db)
        .await
        .map_err(AppError::from)?
        .flatten();
    let base = min_existing.unwrap_or(0);
    base.checked_sub(1).ok_or_else(|| {
        AppError::Internal("Custom author mal_id namespace exhausted for user".into())
    })
}

pub async fn create_custom_author(
    db: &Db,
    user_id: i32,
    req: crate::models::author::CreateAuthorRequest,
) -> Result<AuthorDetail, AppError> {
    let name = sanitize_name(&req.name)?;
    let about = sanitize_about(req.about);

    let txn = db.begin().await.map_err(AppError::from)?;
    let next_id = mint_next_custom_author_id(&txn, user_id).await?;
    let now = Utc::now();
    let model = ActiveModel {
        user_id: Set(Some(user_id)),
        mal_id: Set(next_id),
        name: Set(name),
        given_name: Set(None),
        family_name: Set(None),
        image_url: Set(None),
        about: Set(about),
        birthday: Set(None),
        favorites: Set(0),
        mal_url: Set(None),
        fetched_at: Set(now),
        ..Default::default()
    };
    let inserted = model.insert(&txn).await.map_err(AppError::from)?;
    txn.commit().await.map_err(AppError::from)?;
    Ok(inserted.into())
}

pub async fn update_custom_author(
    db: &Db,
    user_id: i32,
    mal_id: i32,
    req: crate::models::author::UpdateAuthorRequest,
) -> Result<AuthorDetail, AppError> {
    if mal_id >= 0 {
        return Err(AppError::BadRequest(
            "Only custom authors (mal_id < 0) can be edited.".into(),
        ));
    }
    let row = AuthorEntity::find()
        .filter(author::Column::UserId.eq(user_id))
        .filter(author::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound("Author not found".into()))?;
    let mut active: ActiveModel = row.into();
    if let Some(raw_name) = req.name {
        active.name = Set(sanitize_name(&raw_name)?);
    }
    if let Some(raw_about) = req.about {
        active.about = Set(sanitize_about(raw_about));
    }
    let updated = active.update(db).await.map_err(AppError::from)?;
    Ok(updated.into())
}

/// Delete an author from the caller's perspective.
///
///   • Positive mal_id (shared MAL author) → just unlinks every
///     library row of THIS user that referenced it. The shared row
///     stays in the cache for other users.
///   • Negative mal_id (custom author owned by caller) → unlinks
///     the user's library rows AND deletes the row + photo. Custom
///     ids are user-scoped so the storage path is bounded.
///
/// Returns the storage path of any photo that needs to be removed
/// from S3/local — handler does the actual delete since storage
/// access lives on `AppState`.
pub async fn delete_author(
    db: &Db,
    user_id: i32,
    mal_id: i32,
) -> Result<Option<String>, AppError> {
    let txn = db.begin().await.map_err(AppError::from)?;

    // Look up the author row first — we need its synthetic id (the FK
    // target stored on user_libraries.author_id) to drive the unlink,
    // and for custom authors we also need its photo path before delete.
    // Routing by sign:
    //   • mal_id > 0 → shared MAL row (user_id IS NULL)
    //   • mal_id < 0 → custom row owned by this user
    let row = if mal_id > 0 {
        AuthorEntity::find()
            .filter(author::Column::UserId.is_null())
            .filter(author::Column::MalId.eq(mal_id))
            .one(&txn)
            .await
            .map_err(AppError::from)?
    } else if mal_id < 0 {
        AuthorEntity::find()
            .filter(author::Column::UserId.eq(user_id))
            .filter(author::Column::MalId.eq(mal_id))
            .one(&txn)
            .await
            .map_err(AppError::from)?
    } else {
        None
    };

    let Some(row) = row else {
        // Nothing to delete — treat as success. The caller may have
        // double-clicked the delete button; idempotent NO-OP is kinder
        // than a 404.
        txn.commit().await.map_err(AppError::from)?;
        return Ok(None);
    };

    let author_pk = row.id;
    // Photo cleanup is custom-only. Shared MAL rows reference an
    // external Jikan URL we don't own; we never delete those.
    let storage_path = if mal_id < 0 { row.image_url.clone() } else { None };

    // 1. Unlink user_libraries.author_id for THIS user only. Other
    //    users that referenced the same shared MAL row keep their link.
    LibraryEntity::update_many()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::AuthorId.eq(author_pk))
        .col_expr(library::Column::AuthorId, Expr::value(Option::<i32>::None))
        .exec(&txn)
        .await
        .map_err(AppError::from)?;

    // 2. For custom authors only: delete the row itself. Shared MAL
    //    rows stay in the cache for other users.
    if mal_id < 0 {
        AuthorEntity::delete_many()
            .filter(author::Column::UserId.eq(user_id))
            .filter(author::Column::MalId.eq(mal_id))
            .exec(&txn)
            .await
            .map_err(AppError::from)?;
    }

    txn.commit().await.map_err(AppError::from)?;
    Ok(storage_path)
}

/// Update the `image_url` column on a custom author row to point at
/// the supplied storage path. Called by the photo upload handler
/// after the bytes have been written.
pub async fn set_custom_photo_url(
    db: &Db,
    user_id: i32,
    mal_id: i32,
    new_url: Option<String>,
) -> Result<AuthorDetail, AppError> {
    if mal_id >= 0 {
        return Err(AppError::BadRequest(
            "Only custom authors carry a user-uploaded photo.".into(),
        ));
    }
    let row = AuthorEntity::find()
        .filter(author::Column::UserId.eq(user_id))
        .filter(author::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound("Author not found".into()))?;
    let mut active: ActiveModel = row.into();
    active.image_url = Set(new_url);
    let updated = active.update(db).await.map_err(AppError::from)?;
    Ok(updated.into())
}

/// Resolve a custom author's storage key from its URL — used by the
/// photo replace / delete paths to remove the previous blob before
/// writing the new one.
pub async fn current_photo_path(
    db: &Db,
    user_id: i32,
    mal_id: i32,
) -> Result<Option<String>, AppError> {
    let row = AuthorEntity::find()
        .filter(author::Column::UserId.eq(user_id))
        .filter(author::Column::MalId.eq(mal_id))
        .one(db)
        .await
        .map_err(AppError::from)?;
    Ok(row.and_then(|r| r.image_url))
}

/// Jikan ships birthdays as ISO-8601 strings (typically full
/// `YYYY-MM-DDT00:00:00+00:00`, occasionally just `YYYY-MM-DD` or
/// `YYYY-MM-DDTHH:MM:SS`). Try the strict RFC 3339 path first, then
/// fall back to date-only. Returns `None` for empty / unparseable
/// inputs — the bio shows fine without a birthday.
fn parse_birthday(raw: &str) -> Option<DateTime<Utc>> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        return Some(dt.with_timezone(&Utc));
    }
    if let Ok(date) = chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        let naive = date.and_hms_opt(0, 0, 0)?;
        return Utc.from_local_datetime(&naive).single();
    }
    None
}

// ─── FK resolver helpers ───────────────────────────────────────────
//
// The library service writes `user_libraries.author_id` (a synthetic
// FK into `authors.id`), not raw mal_ids or text. These helpers
// translate the inputs the service has on hand (a positive MAL id from
// an upstream sync, or free-text the user typed in the edit form) into
// that FK target, creating rows on demand.

/// Resolve a positive (shared MAL) `mal_id` to an `authors.id`. On a
/// cold cache, fetches the author from Jikan, inserts the row, and
/// returns its id. Used by the MAL-refresh path to attach the author
/// FK after a series sync surfaces a new `author_mal_id`.
///
/// Failure mode: if Jikan errors out (rate limit, 5xx, network blip),
/// returns `Ok(None)` rather than failing the parent operation. The
/// library row stays unlinked; the user can retry the refresh later
/// to populate the FK. We log at warn level so this isn't silent.
pub async fn find_or_create_shared_author_id(
    db: &Db,
    http: &reqwest::Client,
    mal_id: i32,
) -> Result<Option<i32>, AppError> {
    if mal_id <= 0 {
        return Ok(None);
    }
    let cached = AuthorEntity::find()
        .filter(author::Column::UserId.is_null())
        .filter(author::Column::MalId.eq(mal_id))
        .select_only()
        .column(author::Column::Id)
        .into_tuple::<i32>()
        .one(db)
        .await
        .map_err(AppError::from)?;
    if let Some(id) = cached {
        return Ok(Some(id));
    }
    if let Err(err) = fetch_and_upsert_shared(db, http, mal_id).await {
        tracing::warn!(mal_id, %err, "author cache: cold-cache fetch failed; FK left null");
        return Ok(None);
    }
    let after = AuthorEntity::find()
        .filter(author::Column::UserId.is_null())
        .filter(author::Column::MalId.eq(mal_id))
        .select_only()
        .column(author::Column::Id)
        .into_tuple::<i32>()
        .one(db)
        .await
        .map_err(AppError::from)?;
    Ok(after)
}

/// Resolve a user-typed author name to an `authors.id`. Used by the
/// library PATCH path when the user edits the byline on a series.
///
/// Match policy (first hit wins):
///   1. Shared MAL row (`user_id IS NULL`) with case-insensitive name
///      match. Means typing "Naoko Takeuchi" links to the Jikan-cached
///      row instead of duplicating into a custom row.
///   2. Custom row owned by this user, same name match. Reuses an
///      existing custom author the user has already created.
///   3. Mint a fresh custom row with a freshly-minted negative mal_id.
///
/// Empty / whitespace-only input → `Ok(None)` (clear the FK). Length
/// is clamped at `AUTHOR_NAME_MAX_LEN` characters before any lookup.
pub async fn resolve_author_from_text(
    db: &Db,
    user_id: i32,
    raw: &str,
) -> Result<Option<i32>, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let name: String = trimmed.chars().take(AUTHOR_NAME_MAX_LEN).collect();

    // Shared MAL author with same name (case-insensitive). `ilike`
    // without wildcards reduces to exact case-insensitive equality —
    // exactly what we want here, and Postgres can use the
    // `idx_authors_name_ci` index if one is present.
    let shared_match = AuthorEntity::find()
        .filter(author::Column::UserId.is_null())
        .filter(Expr::col(author::Column::Name).ilike(name.clone()))
        .select_only()
        .column(author::Column::Id)
        .into_tuple::<i32>()
        .one(db)
        .await
        .map_err(AppError::from)?;
    if let Some(id) = shared_match {
        return Ok(Some(id));
    }

    let user_match = AuthorEntity::find()
        .filter(author::Column::UserId.eq(user_id))
        .filter(Expr::col(author::Column::Name).ilike(name.clone()))
        .select_only()
        .column(author::Column::Id)
        .into_tuple::<i32>()
        .one(db)
        .await
        .map_err(AppError::from)?;
    if let Some(id) = user_match {
        return Ok(Some(id));
    }

    // No match — mint a custom row. Tx-scoped so the MIN(mal_id)
    // probe and the INSERT see the same snapshot; a concurrent
    // resolver for the same user picks up our newly-inserted minimum.
    let txn = db.begin().await.map_err(AppError::from)?;
    let next_id = mint_next_custom_author_id(&txn, user_id).await?;
    let now = Utc::now();
    let model = ActiveModel {
        user_id: Set(Some(user_id)),
        mal_id: Set(next_id),
        name: Set(name),
        given_name: Set(None),
        family_name: Set(None),
        image_url: Set(None),
        about: Set(None),
        birthday: Set(None),
        favorites: Set(0),
        mal_url: Set(None),
        fetched_at: Set(now),
        ..Default::default()
    };
    let inserted = model.insert(&txn).await.map_err(AppError::from)?;
    txn.commit().await.map_err(AppError::from)?;
    Ok(Some(inserted.id))
}

/// Batch-fetch `AuthorRef`s for a set of `authors.id` values. Used by
/// list endpoints (`get_user_library`, `search`, `get_user_manga`)
/// that return many entries — one round-trip beats N+1 single fetches
/// when the same user owns dozens of series by Naoko Takeuchi or the
/// same custom mangaka.
///
/// Empty input → empty map without hitting the DB. Missing ids are
/// silently dropped from the result; the caller's `entry_with_author`
/// turns those into `author: None` on the entry.
pub async fn lookup_authors_by_ids(
    db: &Db,
    ids: &[i32],
) -> Result<std::collections::HashMap<i32, AuthorRef>, AppError> {
    if ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    let rows = AuthorEntity::find()
        .filter(author::Column::Id.is_in(ids.iter().copied()))
        .all(db)
        .await
        .map_err(AppError::from)?;
    Ok(rows
        .into_iter()
        .map(|a| {
            (
                a.id,
                AuthorRef {
                    id: a.id,
                    mal_id: a.mal_id,
                    name: a.name,
                },
            )
        })
        .collect())
}
