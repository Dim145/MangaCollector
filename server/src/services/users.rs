use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set, TransactionTrait};
use std::sync::Arc;

use crate::db::Db;
use crate::errors::AppError;
use crate::models::activity::Entity as ActivityEntity;
use crate::models::coffret::Entity as CoffretEntity;
use crate::models::library::{self, Entity as LibraryEntity};
use crate::models::setting::Entity as SettingEntity;
use crate::models::library::LibraryEntry;
use crate::models::user::{
    self, ActiveModel, Entity as UserEntity, PublicLibraryEntry, PublicProfileResponse,
    PublicProfileStats, User,
};
use crate::models::volume::{self as volume_mod, Entity as VolumeEntity};
use crate::storage::StorageBackend;

pub async fn get_by_id(db: &Db, id: i32) -> Result<Option<User>, AppError> {
    UserEntity::find_by_id(id).one(db).await.map_err(AppError::from)
}

pub async fn find_by_provider_id(db: &Db, provider_id: &str) -> Result<Option<User>, AppError> {
    UserEntity::find()
        .filter(user::Column::GoogleId.eq(provider_id))
        .one(db)
        .await
        .map_err(AppError::from)
}

/// Look up a user by their normalised (lowercase) public slug. Returns
/// `None` when no user has reserved that handle.
pub async fn find_by_public_slug(
    db: &Db,
    slug: &str,
) -> Result<Option<User>, AppError> {
    UserEntity::find()
        .filter(user::Column::PublicSlug.eq(slug.to_lowercase()))
        .one(db)
        .await
        .map_err(AppError::from)
}

/// Validate + normalise a candidate public slug.
///
/// Returns `Ok(Some(normalised))` if valid, `Ok(None)` to disable the
/// profile (null/empty input), or `Err(AppError::BadRequest)` for any
/// format violation.
///
/// Rules:
///   - 3..=32 chars after normalisation
///   - `[a-z0-9-]` only (lowercase letters, digits, hyphen)
///   - first + last char cannot be `-`
///   - no consecutive `-` (prevents visual confusion like `foo--bar`)
///   - reserved slugs blocked: admin/api/auth/public/u/me/settings/etc.
pub fn validate_public_slug(input: Option<&str>) -> Result<Option<String>, AppError> {
    let trimmed = input.map(|s| s.trim()).unwrap_or("");
    if trimmed.is_empty() {
        return Ok(None);
    }
    let normalised = trimmed.to_lowercase();
    let len = normalised.chars().count();
    if !(3..=32).contains(&len) {
        return Err(AppError::BadRequest(
            "Slug must be 3 to 32 characters long.".into(),
        ));
    }
    for (i, c) in normalised.chars().enumerate() {
        let ok = c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-';
        if !ok {
            return Err(AppError::BadRequest(
                "Slug may only contain lowercase letters, digits and hyphens.".into(),
            ));
        }
        if c == '-' {
            if i == 0 || i == len - 1 {
                return Err(AppError::BadRequest(
                    "Slug cannot start or end with a hyphen.".into(),
                ));
            }
            // No consecutive hyphens.
            if normalised.as_bytes().get(i + 1) == Some(&b'-') {
                return Err(AppError::BadRequest(
                    "Slug cannot contain consecutive hyphens.".into(),
                ));
            }
        }
    }
    if RESERVED_SLUGS.contains(&normalised.as_str()) {
        return Err(AppError::BadRequest("That slug is reserved.".into()));
    }
    Ok(Some(normalised))
}

/// Slugs we never allow — prevents a user grabbing a handle that would
/// shadow or confuse an internal route / common admin endpoint.
const RESERVED_SLUGS: &[&str] = &[
    "admin", "administrator", "api", "auth", "login", "logout",
    "me", "root", "settings", "system", "user", "users", "u",
    "public", "private", "help", "about", "home", "www",
    "new", "edit", "delete", "account", "support",
];

/// Update the user's public slug. Pass `None` to disable the public
/// profile entirely. Returns the final stored value so the handler can
/// echo it to the client.
pub async fn set_public_slug(
    db: &Db,
    user_id: i32,
    slug: Option<&str>,
) -> Result<Option<String>, AppError> {
    let normalised = validate_public_slug(slug)?;

    // Uniqueness check — return a friendly 409 if the slug is already
    // taken by another user. Skip when clearing (normalised=None) or
    // when the user is re-submitting their own current slug.
    if let Some(ref candidate) = normalised {
        let clash = UserEntity::find()
            .filter(user::Column::PublicSlug.eq(candidate.clone()))
            .filter(user::Column::Id.ne(user_id))
            .one(db)
            .await
            .map_err(AppError::from)?;
        if clash.is_some() {
            return Err(AppError::Conflict("That slug is already taken.".into()));
        }
    }

    use sea_orm::Set;
    let now = chrono::Utc::now();
    let mut active: ActiveModel = match UserEntity::find_by_id(user_id)
        .one(db)
        .await
        .map_err(AppError::from)?
    {
        Some(u) => u.into(),
        None => return Err(AppError::Unauthorized),
    };
    active.public_slug = Set(normalised.clone());
    active.modified_on = Set(now);
    // 直 · Race-tight uniqueness handling. The pre-flight SELECT a
    // few lines above closes the common case (two users picking the
    // same slug at different times), but two requests racing the
    // same target slug can both pass that SELECT — only the DB
    // UNIQUE constraint catches them. Without this remap, the
    // loser of the race got a generic 500 mapped from the SeaORM
    // error; with it, they get the same friendly 409 as the
    // pre-flight path so the SPA can surface a single error UX.
    if let Err(err) = active.update(db).await {
        // SQLSTATE 23505 = unique_violation. SeaORM hides the raw
        // sqlx error behind `DbErr::Exec(...)`; we match on the
        // string representation rather than reaching for the inner
        // type because that lets the same code work across DB
        // backends without a feature-flag gate.
        let lowered = err.to_string().to_ascii_lowercase();
        if lowered.contains("23505")
            || lowered.contains("unique constraint")
            || lowered.contains("duplicate key")
        {
            return Err(AppError::Conflict("That slug is already taken.".into()));
        }
        return Err(AppError::from(err));
    }
    Ok(normalised)
}

/// List of genre slugs considered adult. Matches the client-side list.
const PUBLIC_ADULT_GENRES: &[&str] = &["hentai", "erotica", "adult"];

/// True if `g` is an adult-tagged genre (case-insensitive).
fn is_adult_genre(g: &str) -> bool {
    let lower = g.trim().to_lowercase();
    PUBLIC_ADULT_GENRES.iter().any(|bad| *bad == lower)
}

/// Does ANY genre of the entry qualify as adult?
///
/// `pub(crate)` so the public poster handler can enforce the exact
/// same adult filter as `build_public_profile` and `compare_users` —
/// we don't want a series hidden from the gallery but its cover
/// reachable via direct URL.
pub(crate) fn entry_is_adult(genres: &[String]) -> bool {
    genres.iter().any(|g| is_adult_genre(g))
}

/// Deterministic 2-char hanko initials from the display name. Falls back
/// to the first 2 chars of the slug when the name is empty or otherwise
/// useless. Always uppercase, diacritics stripped to ASCII.
fn derive_hanko(display_name: &str, slug: &str) -> String {
    let cleaned: String = display_name
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect();
    let candidate = if cleaned.is_empty() { slug } else { cleaned.as_str() };

    // Prefer word-initials (first letter of first two words) when the
    // display_name splits naturally; fall back to the first two chars.
    let words: Vec<&str> = display_name.split_whitespace().collect();
    if words.len() >= 2 {
        let mut out = String::new();
        for w in words.iter().take(2) {
            if let Some(c) = w.chars().find(|c| c.is_alphabetic()) {
                out.push(c.to_ascii_uppercase());
            }
        }
        if out.chars().count() == 2 {
            return out;
        }
    }
    candidate
        .chars()
        .take(2)
        .collect::<String>()
        .to_uppercase()
}

/// Build the public profile payload for a given user, with adult
/// content filtered out unconditionally and sensitive fields stripped.
pub async fn build_public_profile(
    db: &Db,
    user: &User,
) -> Result<PublicProfileResponse, AppError> {
    let slug = user
        .public_slug
        .clone()
        .ok_or_else(|| AppError::NotFound("Profile not public".into()))?;
    let display_name = user
        .name
        .clone()
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| slug.clone());

    // 祝 · Birthday-mode horizon — single source of truth for whether
    // wishlist (0-owned) entries reach the wire. The frontend's
    // `wishlist_open_until` field on the response carries the same
    // signal, but the SERVER is the only authority here: a stale
    // wishlist horizon in the DB never leaks the wishlist because we
    // gate the library *array itself* on this flag. Without this
    // gate the audit found wishlist entries leaking unconditionally,
    // even with Birthday mode OFF or expired.
    let now = chrono::Utc::now();
    let wishlist_open = user
        .wishlist_public_until
        .map(|t| t > now)
        .unwrap_or(false);

    // Library — load all rows; apply two filters server-side so they
    // never reach the wire:
    //   1. adult content (if the owner hasn't opted-in publicly)
    //   2. wishlist entries (volumes_owned == 0) when the
    //      Birthday-mode horizon is closed
    let library_rows = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user.id))
        .all(db)
        .await?;
    let library: Vec<LibraryEntry> = library_rows
        .into_iter()
        .map(LibraryEntry::from)
        // Adult filter FIRST so we can correctly compute
        // `has_adult_content` later from any entry that survived.
        .filter(|entry| {
            if user.public_show_adult {
                true
            } else {
                !entry_is_adult(&entry.genres)
            }
        })
        // Wishlist filter — only owned (volumes_owned > 0) entries
        // are visible when Birthday mode is closed. A wishlist entry
        // (0 owned) only passes when the horizon is open.
        .filter(|entry| wishlist_open || entry.volumes_owned > 0)
        .collect();

    // Volumes — sweep once for stats + per-series bookkeeping.
    let volumes = VolumeEntity::find()
        .filter(volume_mod::Column::UserId.eq(user.id))
        .all(db)
        .await?;
    // per-mal_id → (owned_count, owned_non_collector, read_set)
    use std::collections::{HashMap, HashSet};
    let mut per_series: HashMap<i32, (i64, i64, HashSet<i32>)> = HashMap::new();
    let mut total_owned: i64 = 0;
    let mut total_read: i64 = 0;
    for v in &volumes {
        if v.owned {
            total_owned += 1;
            if let Some(mal) = v.mal_id {
                let e = per_series.entry(mal).or_default();
                e.0 += 1;
                if !v.collector {
                    e.1 += 1;
                }
            }
        }
        if v.read_at.is_some() {
            total_read += 1;
            if let Some(mal) = v.mal_id {
                per_series.entry(mal).or_default().2.insert(v.vol_num);
            }
        }
    }

    // Build per-entry cards with fully_read + all_collector flags.
    let mut entries: Vec<PublicLibraryEntry> = Vec::with_capacity(library.len());
    let mut fully_read_series: i64 = 0;
    let mut has_adult_content = false;
    for row in library.into_iter() {
        let (owned, non_coll, read_set) = row
            .mal_id
            .and_then(|m| per_series.get(&m).cloned())
            .unwrap_or_default();
        let all_collector = owned > 0 && non_coll == 0;
        let fully_read = row.volumes > 0
            && (1..=row.volumes).all(|n| read_set.contains(&n));
        if fully_read {
            fully_read_series += 1;
        }
        // i64 arithmetic: the old `* 100` path overflowed i32 whenever
        // `row.volumes > i32::MAX / 100` (≈ 21 million). Still a
        // pathological input given clamp_volumes, but cheap to make
        // correct regardless. Result is always in [0, 100] so the
        // final cast back to i32 is safe.
        let read_percent: i32 = if row.volumes > 0 {
            let read_count = read_set.len().min(row.volumes as usize) as i64;
            let pct = (read_count * 100) / (row.volumes as i64);
            pct as i32
        } else {
            0
        };
        let is_adult = entry_is_adult(&row.genres);
        if is_adult {
            has_adult_content = true;
        }
        // Rewrite custom-upload URLs to the public form. The raw
        // value stored in `image_url_jpg` for a custom upload is
        // `/api/user/storage/poster/{mal_id}`, which resolves against
        // the CALLER's library when hit — fine when the owner views
        // their own page, broken for anonymous visitors. The public
        // endpoint takes the slug + mal_id explicitly, so the URL is
        // unambiguous and cacheable across all visitors.
        //
        // External URLs (MAL CDN, MangaDex CDN) pass through unchanged.
        let image_url_jpg = match row.image_url_jpg {
            Some(url) if !crate::services::library::is_external_http_url(&url) => {
                row.mal_id.map(|id| {
                    format!("/api/public/u/{}/poster/{}", slug, id)
                })
            }
            other => other,
        };

        entries.push(PublicLibraryEntry {
            mal_id: row.mal_id,
            name: row.name,
            image_url_jpg,
            volumes: row.volumes,
            volumes_owned: row.volumes_owned,
            genres: row.genres,
            fully_read,
            all_collector,
            read_percent,
            is_adult,
        });
    }

    // Sort library — newest-added first (modified/created DESC would be
    // ideal but we don't expose timestamps publicly; alpha by name is a
    // deterministic fallback that's also pleasant to browse).
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    let since = format!(
        "{:04}-{:02}",
        user.created_on.format("%Y").to_string().parse::<i32>().unwrap_or(2025),
        user.created_on.format("%m").to_string().parse::<i32>().unwrap_or(1)
    );

    // 祝 · Birthday-mode horizon — emit only when still in the future.
    // Same authority as the wishlist filter above: this is what the
    // client uses to render the celebratory banner and the countdown.
    // We re-check against `now` rather than reusing `wishlist_open`
    // so a clock tick between filter and emit can't desync the two.
    let wishlist_open_until = user
        .wishlist_public_until
        .filter(|t| *t > chrono::Utc::now());

    Ok(PublicProfileResponse {
        slug: slug.clone(),
        hanko: derive_hanko(&display_name, &slug),
        display_name,
        since,
        stats: PublicProfileStats {
            series_count: entries.len() as i64,
            volumes_owned: total_owned,
            volumes_read: total_read,
            fully_read_series,
        },
        library: entries,
        has_adult_content,
        wishlist_open_until,
    })
}

/// 祝 · Set the wishlist-public horizon.
///
/// Positive `days` arms the toggle to `now() + days` (clamped to a
/// reasonable upper bound to defang adversarial values like `i64::MAX`,
/// which would overflow the timestamp arithmetic). Zero or negative
/// disables the feature outright. Returns the resolved horizon so the
/// client can hydrate from a canonical value.
pub async fn set_wishlist_public_until(
    db: &Db,
    user_id: i32,
    days: i64,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, AppError> {
    // Cap the lifetime so a malformed client (or a JSON injection)
    // can't pin the wishlist open for centuries. 365 days is plenty
    // for the documented use case (birthday / wedding / housewarming);
    // the server-side cap means we don't trust the SPA's value blindly.
    const MAX_DAYS: i64 = 365;
    let now = chrono::Utc::now();
    let until = if days <= 0 {
        None
    } else {
        let clamped = days.min(MAX_DAYS);
        // `checked_add_signed` instead of `+` so a future bump of
        // MAX_DAYS to a pathological value (or a clock-skew + max
        // accumulation) can't panic on i64 overflow. With clamped
        // ≤ 365 today this is purely defensive — but the cost is
        // a single branch and it removes a non-obvious panic site.
        chrono::Duration::try_days(clamped)
            .and_then(|d| now.checked_add_signed(d))
    };

    let mut active: ActiveModel = match UserEntity::find_by_id(user_id)
        .one(db)
        .await
        .map_err(AppError::from)?
    {
        Some(u) => u.into(),
        None => return Err(AppError::Unauthorized),
    };
    active.wishlist_public_until = Set(until);
    active.modified_on = Set(now);
    active.update(db).await.map_err(AppError::from)?;
    Ok(until)
}

// ── 暦 · Calendar ICS token lifecycle ─────────────────────────────────
//
// Three operations gate the subscribable ICS feed:
//
//   - `ensure_calendar_token`   → mint a token if missing, return it.
//                                 Idempotent (returns the existing one
//                                 when present). Used by the SPA the
//                                 first time the user opens the
//                                 "Subscribe" modal.
//   - `regenerate_calendar_token`→ ALWAYS mint a fresh one, replacing
//                                 the previous value. Invalidates any
//                                 leaked URL.
//   - `find_by_calendar_token`  → reverse lookup for the public ICS
//                                 handler — the token IS the auth.
//                                 Returns the user (so the handler can
//                                 scope the calendar listing) or None.

/// Look up a user by their secret calendar token. Returns `None`
/// when no user has that token (or `token` is empty / malformed) —
/// the caller maps this to a 404, never a 401, so an attacker
/// brute-forcing the token space gets the exact same shape of
/// response for "wrong" and "missing" inputs.
pub async fn find_by_calendar_token(
    db: &Db,
    token: &str,
) -> Result<Option<User>, AppError> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    UserEntity::find()
        .filter(user::Column::CalendarToken.eq(trimmed.to_string()))
        .one(db)
        .await
        .map_err(AppError::from)
}

/// Lazily mint a calendar token. If the user already has one, it's
/// returned unchanged — the caller can rely on stable URL semantics
/// across repeated calls. This is the only path that minters NEW
/// tokens for users who haven't subscribed yet.
pub async fn ensure_calendar_token(
    db: &Db,
    user_id: i32,
) -> Result<String, AppError> {
    use sea_orm::Set;
    let row = UserEntity::find_by_id(user_id)
        .one(db)
        .await
        .map_err(AppError::from)?
        .ok_or(AppError::Unauthorized)?;
    if let Some(existing) = row.calendar_token.as_ref() {
        if !existing.is_empty() {
            return Ok(existing.clone());
        }
    }

    let token = uuid::Uuid::new_v4().to_string();
    let mut active: ActiveModel = row.into();
    active.calendar_token = Set(Some(token.clone()));
    active.modified_on = Set(Utc::now());
    active.update(db).await.map_err(AppError::from)?;
    Ok(token)
}

/// Regenerate the calendar token unconditionally. Used by the user
/// when they suspect the previous URL has leaked — the old token is
/// dropped and any subscriber stops receiving updates after their
/// next refresh.
pub async fn regenerate_calendar_token(
    db: &Db,
    user_id: i32,
) -> Result<String, AppError> {
    use sea_orm::Set;
    let row = UserEntity::find_by_id(user_id)
        .one(db)
        .await
        .map_err(AppError::from)?
        .ok_or(AppError::Unauthorized)?;
    let token = uuid::Uuid::new_v4().to_string();
    let mut active: ActiveModel = row.into();
    active.calendar_token = Set(Some(token.clone()));
    active.modified_on = Set(Utc::now());
    active.update(db).await.map_err(AppError::from)?;
    Ok(token)
}

/// Toggle the "include adult content in public profile" opt-in. Takes
/// a simple boolean because the action is unambiguous — no distinction
/// between "unset" and "false".
pub async fn set_public_show_adult(
    db: &Db,
    user_id: i32,
    show_adult: bool,
) -> Result<bool, AppError> {
    let now = chrono::Utc::now();
    let mut active: ActiveModel = match UserEntity::find_by_id(user_id)
        .one(db)
        .await
        .map_err(AppError::from)?
    {
        Some(u) => u.into(),
        None => return Err(AppError::Unauthorized),
    };
    active.public_show_adult = Set(show_adult);
    active.modified_on = Set(now);
    active.update(db).await.map_err(AppError::from)?;
    Ok(show_adult)
}

pub async fn create(
    db: &Db,
    provider_id: &str,
    email: Option<&str>,
    name: Option<&str>,
) -> Result<User, AppError> {
    let now = Utc::now();
    let model = ActiveModel {
        created_on: Set(now),
        modified_on: Set(now),
        google_id: Set(Some(provider_id.to_string())),
        email: Set(email.map(|s| s.to_string())),
        name: Set(name.map(|s| s.to_string())),
        ..Default::default()
    };
    model.insert(db).await.map_err(AppError::from)
}

/// Hard-delete every row belonging to this user + every custom poster
/// uploaded to S3 / local storage. Used by the GDPR "delete my account"
/// flow.
///
/// Order matters:
///   1. Collect mal_ids owned by the user BEFORE nuking the library rows,
///      so we know which poster keys to delete from storage.
///   2. Delete posters (best-effort; storage failures are logged but don't
///      abort — better to have orphaned blobs than a failed account
///      deletion).
///   3. Wipe every child table in a single transaction. Foreign keys are
///      NOT necessarily declared with ON DELETE CASCADE, so we spell out
///      each table explicitly. Order within the transaction: children
///      first (volumes, activity…) then parents (library) then the user
///      row itself.
pub async fn delete_account(
    db: &Db,
    storage: Arc<dyn StorageBackend>,
    user_id: i32,
) -> Result<(), AppError> {
    // 1. Gather mal_ids for poster paths.
    let rows = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .all(db)
        .await
        .map_err(AppError::from)?;
    let mal_ids: Vec<i32> = rows.iter().filter_map(|r| r.mal_id).collect();

    // 2. Delete poster blobs from storage — best-effort. Covers the case
    //    where image_url_jpg is null but a file still lingers at the
    //    canonical key (shouldn't happen in practice, but being thorough
    //    keeps the cleanup verifiable).
    for mal_id in &mal_ids {
        let path = format!("uploads/images/{}/{}.jpg", user_id, mal_id);
        if let Err(e) = storage.remove(&path).await {
            tracing::warn!(user_id, mal_id, error = %e, "delete_account: poster removal failed (continuing)");
        }
    }

    // 3. Wipe all user-scoped tables + the user row itself, transactionally.
    let txn = db.begin().await.map_err(AppError::from)?;

    VolumeEntity::delete_many()
        .filter(crate::models::volume::Column::UserId.eq(user_id))
        .exec(&txn)
        .await
        .map_err(AppError::from)?;

    CoffretEntity::delete_many()
        .filter(crate::models::coffret::Column::UserId.eq(user_id))
        .exec(&txn)
        .await
        .map_err(AppError::from)?;

    ActivityEntity::delete_many()
        .filter(crate::models::activity::Column::UserId.eq(user_id))
        .exec(&txn)
        .await
        .map_err(AppError::from)?;

    SettingEntity::delete_many()
        .filter(crate::models::setting::Column::UserId.eq(user_id))
        .exec(&txn)
        .await
        .map_err(AppError::from)?;

    LibraryEntity::delete_many()
        .filter(library::Column::UserId.eq(user_id))
        .exec(&txn)
        .await
        .map_err(AppError::from)?;

    UserEntity::delete_by_id(user_id)
        .exec(&txn)
        .await
        .map_err(AppError::from)?;

    txn.commit().await.map_err(AppError::from)?;

    tracing::info!(user_id, posters = mal_ids.len(), "account deleted");
    Ok(())
}
