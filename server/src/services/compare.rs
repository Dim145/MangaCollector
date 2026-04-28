//! 対照 · Compare two users' libraries into three buckets.

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use std::collections::{HashMap, HashSet};

use crate::db::Db;
use crate::errors::AppError;
use crate::models::compare::{CompareEntry, CompareResponse, CompareUser};
use crate::models::library::{self, Entity as LibraryEntity, LibraryEntry};
use crate::models::user::{User, derive_hanko};
use crate::models::volume::{self as volume_mod, Entity as VolumeEntity};

/// Genres that flag a series as adult. Mirrors the list used on the
/// public profile; we filter `their` library by it unless the other
/// user has opted adult content into their public profile. `my`
/// library is never filtered — it's my own data.
const PUBLIC_ADULT_GENRES: &[&str] = &["hentai", "erotica", "adult"];

fn is_adult(genres: &[String]) -> bool {
    genres.iter().any(|g| {
        let lower = g.trim().to_lowercase();
        PUBLIC_ADULT_GENRES.iter().any(|bad| *bad == lower)
    })
}

async fn load_entries(db: &Db, user_id: i32) -> Result<Vec<LibraryEntry>, AppError> {
    let rows = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .all(db)
        .await?;
    Ok(rows.into_iter().map(LibraryEntry::from).collect())
}

async fn total_owned_volumes(db: &Db, user_id: i32) -> Result<i64, AppError> {
    let rows = VolumeEntity::find()
        .filter(volume_mod::Column::UserId.eq(user_id))
        .all(db)
        .await?;
    Ok(rows.iter().filter(|v| v.owned).count() as i64)
}

fn to_entry(entry: &LibraryEntry) -> CompareEntry {
    CompareEntry {
        mal_id: entry.mal_id,
        name: entry.name.clone(),
        image_url_jpg: entry.image_url_jpg.clone(),
        volumes: entry.volumes,
        genres: entry.genres.clone(),
    }
}

/// Serialise a library entry that belongs to the OTHER user (i.e. ends
/// up in the `their_only` bucket) with its custom-upload URL rewritten
/// to the slug-scoped public endpoint. Without this, the caller's
/// browser would hit `/api/user/storage/poster/{mal_id}` against its
/// own session and see either a 404 or (worse) its own cover for the
/// same mal_id. Entries with external CDN URLs pass through untouched.
fn to_entry_public(entry: &LibraryEntry, other_slug: &str) -> CompareEntry {
    let image_url_jpg = match entry.image_url_jpg.as_deref() {
        Some(url)
            if !url.is_empty()
                && !crate::services::library::is_external_http_url(url) =>
        {
            entry
                .mal_id
                .map(|id| format!("/api/public/u/{}/poster/{}", other_slug, id))
        }
        _ => entry.image_url_jpg.clone(),
    };
    CompareEntry {
        mal_id: entry.mal_id,
        name: entry.name.clone(),
        image_url_jpg,
        volumes: entry.volumes,
        genres: entry.genres.clone(),
    }
}

pub async fn compare_users(
    db: &Db,
    me: &User,
    other: &User,
) -> Result<CompareResponse, AppError> {
    // Load both libraries.
    let mine = load_entries(db, me.id).await?;
    let theirs_raw = load_entries(db, other.id).await?;

    // Filter the OTHER user's library for adult content — but only if
    // they haven't opted-in to public adult exposure. My own library
    // is always shown in full (even if I've opted-out publicly).
    let theirs: Vec<LibraryEntry> = if other.public_show_adult {
        theirs_raw
    } else {
        theirs_raw
            .into_iter()
            .filter(|e| !is_adult(&e.genres))
            .collect()
    };

    // Build lookup by mal_id. Entries without a mal_id (custom series)
    // can never match across users by definition, so they always fall
    // into their owner's `*_only` bucket.
    let their_by_mal: HashMap<i32, &LibraryEntry> = theirs
        .iter()
        .filter_map(|e| e.mal_id.map(|m| (m, e)))
        .collect();
    let my_mal_set: HashSet<i32> = mine
        .iter()
        .filter_map(|e| e.mal_id)
        .collect();

    // Three buckets.
    let mut shared: Vec<CompareEntry> = Vec::new();
    let mut mine_only: Vec<CompareEntry> = Vec::new();
    let mut their_only: Vec<CompareEntry> = Vec::new();

    for entry in &mine {
        match entry.mal_id {
            Some(mal) if their_by_mal.contains_key(&mal) => {
                // Shared — use my version of the metadata (I own my
                // card's cover preferences; if I've set a custom
                // poster it shows up here).
                shared.push(to_entry(entry));
            }
            _ => mine_only.push(to_entry(entry)),
        }
    }
    // Pre-compute the other user's slug here — `compare_users` is only
    // reachable when `find_by_public_slug` already resolved it, so this
    // is always Some. The empty-string fallback is purely defensive
    // (the resulting public URLs would 404 on that branch, which is
    // the correct behaviour if we ever call this without a slug).
    let their_slug_for_urls = other.public_slug.as_deref().unwrap_or("");
    for entry in &theirs {
        match entry.mal_id {
            Some(mal) if my_mal_set.contains(&mal) => {
                // Already in `shared` via my version — skip.
            }
            // Their-only bucket: rewrite custom-upload URLs to the
            // slug-scoped public form so the caller's browser can
            // actually fetch them without auth against the other
            // user's library.
            _ => their_only.push(to_entry_public(entry, their_slug_for_urls)),
        }
    }

    // Sort alphabetically within each bucket for stable browsing.
    let alpha = |a: &CompareEntry, b: &CompareEntry| {
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    };
    shared.sort_by(alpha);
    mine_only.sort_by(alpha);
    their_only.sort_by(alpha);

    // User summaries.
    let me_name = me
        .name
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("user-{}", me.id));
    let me_slug_or_name = me.public_slug.as_deref().unwrap_or(&me_name);
    let other_slug = other.public_slug.clone();
    let other_name = other
        .name
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| other_slug.clone().unwrap_or_default());
    let other_slug_ref = other_slug.as_deref().unwrap_or(&other_name);

    let me_owned = total_owned_volumes(db, me.id).await?;
    let other_owned = total_owned_volumes(db, other.id).await?;

    Ok(CompareResponse {
        me: CompareUser {
            slug: me.public_slug.clone(),
            display_name: me_name.clone(),
            hanko: derive_hanko(&me_name, me_slug_or_name),
            series_count: mine.len() as i64,
            volumes_owned: me_owned,
        },
        other: CompareUser {
            slug: other.public_slug.clone(),
            display_name: other_name.clone(),
            hanko: derive_hanko(&other_name, other_slug_ref),
            series_count: theirs.len() as i64,
            volumes_owned: other_owned,
        },
        shared,
        mine_only,
        their_only,
    })
}
