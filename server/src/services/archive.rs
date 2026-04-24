//! 写本 · Archive service.
//!
//! Pure functions that transform between the DB state and the
//! shareable ExportBundle. Kept separate from `users` because the
//! concerns are orthogonal: users deals with identity/auth, archive
//! deals with data portability.

use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use std::collections::{HashMap, HashSet};

use crate::db::Db;
use crate::errors::AppError;
use crate::models::archive::{
    ExportBundle, ExportCoffret, ExportSeries, ExportSettings, ExportUser,
    ExportVolume, ImportAddedSummary, ImportPreview, EXPORT_VERSION,
};
use crate::models::coffret::{self, Entity as CoffretEntity};
use crate::models::library::{self, Entity as LibraryEntity};
use crate::models::setting::Entity as SettingEntity;
use crate::models::user::{Entity as UserEntity, User};
use crate::models::volume::{self as volume_mod, Entity as VolumeEntity};

/// Build a complete export bundle for the given user.
pub async fn build_export(db: &Db, user: &User) -> Result<ExportBundle, AppError> {
    // ─── Settings ───
    let setting = SettingEntity::find()
        .filter(crate::models::setting::Column::UserId.eq(user.id))
        .one(db)
        .await
        .map_err(AppError::from)?;
    let settings = setting.map(|s| ExportSettings {
        currency: s.currency,
        title_type: s.title_type,
        adult_content_level: s.adult_content_level,
        theme: s.theme,
        language: s.language,
    });

    // ─── Library rows ───
    let library_rows = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user.id))
        .all(db)
        .await
        .map_err(AppError::from)?;

    // ─── Volumes + coffrets (bulk-loaded then grouped in-memory) ───
    let volume_rows = VolumeEntity::find()
        .filter(volume_mod::Column::UserId.eq(user.id))
        .all(db)
        .await
        .map_err(AppError::from)?;
    let coffret_rows = CoffretEntity::find()
        .filter(coffret::Column::UserId.eq(user.id))
        .all(db)
        .await
        .map_err(AppError::from)?;

    let mut volumes_by_mal: HashMap<i32, Vec<crate::models::volume::Model>> =
        HashMap::new();
    for v in volume_rows {
        if let Some(mal) = v.mal_id {
            volumes_by_mal.entry(mal).or_default().push(v);
        }
    }
    let mut coffrets_by_mal: HashMap<i32, Vec<crate::models::coffret::Model>> =
        HashMap::new();
    for c in coffret_rows {
        coffrets_by_mal.entry(c.mal_id).or_default().push(c);
    }

    // ─── Shape each series ───
    let mut library: Vec<ExportSeries> = Vec::with_capacity(library_rows.len());
    for row in library_rows {
        let mal_key = row.mal_id.unwrap_or(0);
        let mut vols: Vec<ExportVolume> = volumes_by_mal
            .remove(&mal_key)
            .unwrap_or_default()
            .into_iter()
            .map(|v| ExportVolume {
                vol_num: v.vol_num,
                owned: v.owned,
                price: v.price,
                store: v.store,
                collector: v.collector,
                read_at: v.read_at,
                in_coffret: v.coffret_id.is_some(),
            })
            .collect();
        vols.sort_by_key(|v| v.vol_num);

        let coffrets: Vec<ExportCoffret> = coffrets_by_mal
            .remove(&mal_key)
            .unwrap_or_default()
            .into_iter()
            .map(|c| ExportCoffret {
                name: c.name,
                vol_start: c.vol_start,
                vol_end: c.vol_end,
                price: c.price,
                store: c.store,
            })
            .collect();

        let genres: Vec<String> = row
            .genres
            .as_deref()
            .unwrap_or("")
            .split(',')
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect();

        library.push(ExportSeries {
            mal_id: row.mal_id,
            mangadex_id: row.mangadex_id,
            name: row.name,
            volumes: row.volumes,
            volumes_owned: row.volumes_owned,
            image_url_jpg: row.image_url_jpg,
            genres,
            volumes_detail: vols,
            coffrets,
        });
    }
    library.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(ExportBundle {
        version: EXPORT_VERSION,
        exported_at: Utc::now(),
        source: "MangaCollector".into(),
        user: ExportUser {
            name: user.name.clone(),
        },
        settings,
        library,
    })
}

/// Flatten the whole archive into CSV rows — one line per volume of
/// every series (so a collector can open the file in a spreadsheet and
/// sort/pivot freely). Returns the raw CSV text including the header.
pub fn build_export_csv(bundle: &ExportBundle) -> String {
    let mut out = String::new();
    out.push_str(
        "mal_id,series,vol_num,owned,collector,read_at,price,store,genres\n",
    );
    for series in &bundle.library {
        let mal = series
            .mal_id
            .map(|i| i.to_string())
            .unwrap_or_default();
        let name = csv_escape(&series.name);
        let genres = csv_escape(&series.genres.join("|"));
        if series.volumes_detail.is_empty() {
            // No per-volume detail — emit a single summary row so the
            // series still appears in the CSV.
            out.push_str(&format!(
                "{mal},{name},,,,,,,{genres}\n"
            ));
            continue;
        }
        for v in &series.volumes_detail {
            let price = v
                .price
                .map(|p| p.to_string())
                .unwrap_or_default();
            let store = csv_escape(v.store.as_deref().unwrap_or(""));
            let read = v
                .read_at
                .map(|t| t.to_rfc3339())
                .unwrap_or_default();
            out.push_str(&format!(
                "{mal},{name},{vol},{owned},{collector},{read},{price},{store},{genres}\n",
                vol = v.vol_num,
                owned = v.owned,
                collector = v.collector,
            ));
        }
    }
    out
}

/// CSV-escape a single field: wrap in double quotes if it contains
/// comma, quote, or newline; double any embedded quotes.
fn csv_escape(s: &str) -> String {
    let needs_quote =
        s.contains(',') || s.contains('"') || s.contains('\n');
    if !needs_quote {
        return s.to_string();
    }
    let escaped = s.replace('"', "\"\"");
    format!("\"{}\"", escaped)
}

/// Apply an import bundle in **merge** mode. Series whose mal_id is
/// already present in the user's library are skipped (reported as
/// conflicts). Entries without a mal_id are always added as new custom
/// entries (with a fresh negative mal_id if needed, same logic as the
/// existing custom-entry flow).
///
/// When `dry_run=true`, no writes are performed — we only walk the
/// bundle to compute the preview counts.
pub async fn apply_import_merge(
    db: &Db,
    user: &User,
    bundle: &ExportBundle,
    dry_run: bool,
) -> Result<ImportPreview, AppError> {
    // Version gate — reject unknown schemas outright.
    if bundle.version > EXPORT_VERSION {
        return Err(AppError::BadRequest(format!(
            "Unknown export version {} (supported up to {}).",
            bundle.version, EXPORT_VERSION
        )));
    }

    // Pre-fetch the current library's mal_ids so we can detect conflicts
    // in one query.
    let existing_mal_ids: HashSet<i32> = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user.id))
        .all(db)
        .await
        .map_err(AppError::from)?
        .into_iter()
        .filter_map(|r| r.mal_id)
        .collect();

    // For custom entries with mal_id < 0 we need to mint fresh negative
    // IDs that don't clash. Find the current floor.
    //
    // On DB error we fall back to `None` (→ starting at -1), but log a
    // warning first so the silent degradation is diagnosable if it
    // produces surprising duplicate-entry errors downstream.
    let min_mal_id: Option<i32> = match LibraryEntity::find()
        .filter(library::Column::UserId.eq(user.id))
        .filter(library::Column::MalId.lt(0))
        .all(db)
        .await
    {
        Ok(rows) => rows.iter().filter_map(|r| r.mal_id).min(),
        Err(err) => {
            tracing::warn!(
                %err,
                user_id = user.id,
                "apply_import_merge: MIN(mal_id) lookup failed, starting from -1"
            );
            None
        }
    };
    // Overflow-safe: if the user somehow has a row with mal_id = i32::MIN,
    // `v - 1` would panic in debug / wrap in release. `checked_sub` falls
    // back to -1 in that case; the UNIQUE(user_id, mal_id) partial index
    // will reject the eventual duplicate and the import fails cleanly
    // instead of silently corrupting data.
    let mut next_custom_id: i32 = min_mal_id
        .and_then(|v| v.checked_sub(1))
        .unwrap_or(-1);

    let mut preview = ImportPreview {
        total_in_file: bundle.library.len(),
        ..Default::default()
    };

    for series in &bundle.library {
        if series.name.trim().is_empty() || series.volumes < 0 {
            preview.skipped_invalid += 1;
            continue;
        }
        // Conflict check: if the bundle carries a positive mal_id that
        // matches an existing library row, skip in merge mode.
        if let Some(mal) = series.mal_id {
            if mal > 0 && existing_mal_ids.contains(&mal) {
                preview.skipped_conflict += 1;
                preview.conflict_series.push(ImportAddedSummary {
                    mal_id: Some(mal),
                    name: series.name.clone(),
                    volumes: series.volumes,
                    owned_volumes: series
                        .volumes_detail
                        .iter()
                        .filter(|v| v.owned)
                        .count(),
                });
                continue;
            }
        }

        preview.added += 1;
        let owned_count = series
            .volumes_detail
            .iter()
            .filter(|v| v.owned)
            .count();
        preview.added_series.push(ImportAddedSummary {
            mal_id: series.mal_id,
            name: series.name.clone(),
            volumes: series.volumes,
            owned_volumes: owned_count,
        });

        if dry_run {
            continue;
        }

        // Persist — library row first, then volumes, then coffrets.
        let assigned_mal = match series.mal_id {
            Some(m) if m > 0 => Some(m),
            // Custom entries use negative mal_ids. Honour the imported
            // ID if it's still free, otherwise mint a new one so the
            // NOT NULL/UNIQUE(user, mal_id) invariant holds.
            _ => {
                let mal = next_custom_id;
                // `saturating_sub` pins at i32::MIN on overflow. The
                // UNIQUE index guarantees that the subsequent INSERT
                // fails rather than silently producing duplicates if
                // we've actually reached that range (which requires
                // 2.1 billion custom entries — effectively never).
                next_custom_id = next_custom_id.saturating_sub(1);
                Some(mal)
            }
        };

        // Clamp imported counts to the same ceiling the live write
        // paths enforce — a malicious or malformed bundle can't sneak
        // past here to create billions of INSERTs. We mutate a local
        // binding rather than the input struct so the preview summary
        // above still reports what was *actually* in the bundle.
        let series_volumes = crate::services::library::clamp_volumes(series.volumes);
        let series_volumes_owned = crate::services::library::clamp_volumes(series.volumes_owned)
            .min(series_volumes);

        let genres_str = series.genres.join(",");
        let now = Utc::now();
        let lib_active = library::ActiveModel {
            user_id: Set(user.id),
            mal_id: Set(assigned_mal),
            name: Set(series.name.clone()),
            volumes: Set(series_volumes),
            volumes_owned: Set(series_volumes_owned),
            image_url_jpg: Set(series.image_url_jpg.clone()),
            genres: Set(if genres_str.is_empty() {
                None
            } else {
                Some(genres_str)
            }),
            mangadex_id: Set(series.mangadex_id.clone()),
            created_on: Set(now),
            modified_on: Set(now),
            ..Default::default()
        };
        lib_active.insert(db).await.map_err(AppError::from)?;

        // Volumes — two codepaths:
        //
        //  A. Bundle carries explicit per-volume detail (our own JSON
        //     export, or a future v2 import format). Restore verbatim.
        //
        //  B. External imports (MAL/AniList/Yamtrack) ship just a
        //     `volumes` count + a `volumes_owned` count, no per-volume
        //     rows. Without synthesising user_volumes entries, the
        //     MangaPage shows an empty "Tomes" list even though the
        //     dashboard reads `library.volumes/volumes_owned` and
        //     renders them correctly — that asymmetry was the source
        //     of the bug where users had to manually reset the total
        //     volume count to regenerate the rows.
        //
        // For path B, we synthesise vol_num 1..=volumes and mark the
        // first `volumes_owned` of them as `owned=true` (the classic
        // "I've got tomes 1 through N" convention, which matches how
        // `update_manga_volumes` reseeds the rows when the user edits
        // the total manually).
        if !series.volumes_detail.is_empty() {
            for v in &series.volumes_detail {
                let active = volume_mod::ActiveModel {
                    user_id: Set(user.id),
                    mal_id: Set(assigned_mal),
                    vol_num: Set(v.vol_num),
                    owned: Set(v.owned),
                    price: Set(v.price),
                    store: Set(v.store.clone()),
                    collector: Set(v.collector),
                    read_at: Set(v.read_at),
                    created_on: Set(now),
                    modified_on: Set(now),
                    ..Default::default()
                };
                active.insert(db).await.map_err(AppError::from)?;
            }
        } else if series_volumes > 0 {
            let owned_up_to = series_volumes_owned;
            for vol_num in 1..=series_volumes {
                let active = volume_mod::ActiveModel {
                    user_id: Set(user.id),
                    mal_id: Set(assigned_mal),
                    vol_num: Set(vol_num),
                    owned: Set(vol_num <= owned_up_to),
                    price: Set(None),
                    store: Set(None),
                    collector: Set(false),
                    read_at: Set(None),
                    created_on: Set(now),
                    modified_on: Set(now),
                    ..Default::default()
                };
                active.insert(db).await.map_err(AppError::from)?;
            }
        }

        // Coffrets — names & ranges only. Volumes aren't re-linked to
        // a coffret_id here; doing so would require a second pass and
        // the v1 import contract is "restore metadata, user can
        // re-assign coffrets if needed". The per-volume `in_coffret`
        // flag in the bundle is advisory for future versions.
        for c in &series.coffrets {
            let active = coffret::ActiveModel {
                user_id: Set(user.id),
                mal_id: Set(assigned_mal.unwrap_or(0)),
                name: Set(c.name.clone()),
                vol_start: Set(c.vol_start),
                vol_end: Set(c.vol_end),
                price: Set(c.price),
                store: Set(c.store.clone()),
                created_on: Set(now),
                modified_on: Set(now),
                ..Default::default()
            };
            active.insert(db).await.map_err(AppError::from)?;
        }
    }

    // Swallow the unused-arg warning.
    let _ = UserEntity::find_by_id(user.id);

    Ok(preview)
}
