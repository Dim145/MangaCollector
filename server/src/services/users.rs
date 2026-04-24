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
    active.update(db).await.map_err(AppError::from)?;
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
fn entry_is_adult(genres: &[String]) -> bool {
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

    // Library — load all rows; if the owner hasn't opted-in to public
    // adult content, drop adult-tagged entries server-side so they
    // never reach the wire.
    let library_rows = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user.id))
        .all(db)
        .await?;
    let library: Vec<LibraryEntry> = library_rows
        .into_iter()
        .map(LibraryEntry::from)
        .filter(|entry| {
            if user.public_show_adult {
                true
            } else {
                !entry_is_adult(&entry.genres)
            }
        })
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
        entries.push(PublicLibraryEntry {
            mal_id: row.mal_id,
            name: row.name,
            image_url_jpg: row.image_url_jpg,
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
    })
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
