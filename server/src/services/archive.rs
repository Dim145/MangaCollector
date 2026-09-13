//! 写本 · Archive service.
//!
//! Pure functions that transform between the DB state and the
//! shareable ExportBundle. Kept separate from `users` because the
//! concerns are orthogonal: users deals with identity/auth, archive
//! deals with data portability.

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set, TransactionTrait,
};
use std::collections::HashMap;

use crate::db::Db;
use crate::errors::AppError;
use crate::models::archive::{
    EXPORT_VERSION, ExportBundle, ExportCoffret, ExportLoan, ExportLocation, ExportSeries,
    ExportSettings, ExportUser, ExportVolume, ImportAddedSummary, ImportMode, ImportPreview,
};
use crate::models::coffret::{self, Entity as CoffretEntity};
use crate::models::follow::{self, Entity as FollowEntity};
use crate::models::library::{self, Entity as LibraryEntity};
use crate::models::setting::Entity as SettingEntity;
use crate::models::user::{self as user_mod, Entity as UserEntity, User};
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

    // ─── Author names — a shared table keyed by id; ids don't travel
    //     across instances, the bundle carries the text ───
    let author_ids: Vec<i32> = {
        let mut ids: Vec<i32> = library_rows.iter().filter_map(|r| r.author_id).collect();
        ids.sort_unstable();
        ids.dedup();
        ids
    };
    let author_names = if author_ids.is_empty() {
        HashMap::new()
    } else {
        crate::services::author::lookup_authors_by_ids(db, &author_ids).await?
    };

    // 友 · Linked borrowers travel as public slugs — ids are per instance.
    let borrower_ids: Vec<i32> = {
        let mut ids: Vec<i32> = volumes_by_mal
            .values()
            .flatten()
            .filter_map(|v| v.loaned_to_user_id)
            .collect();
        ids.sort_unstable();
        ids.dedup();
        ids
    };
    let borrower_slugs: HashMap<i32, String> = if borrower_ids.is_empty() {
        HashMap::new()
    } else {
        UserEntity::find()
            .filter(user_mod::Column::Id.is_in(borrower_ids))
            .all(db)
            .await
            .map_err(AppError::from)?
            .into_iter()
            .filter_map(|u| Some((u.id, u.public_slug?)))
            .collect()
    };

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
                notes: v.notes,
                in_coffret: v.coffret_id.is_some(),
                release_date: v.release_date,
                release_isbn: v.release_isbn,
                release_url: v.release_url,
                origin: Some(v.origin),
                announced_at: v.announced_at,
                loaned_to: v.loaned_to,
                loan_started_at: v.loan_started_at,
                loan_due_at: v.loan_due_at,
                loaned_to_slug: v
                    .loaned_to_user_id
                    .and_then(|id| borrower_slugs.get(&id).cloned()),
                condition: v.condition,
                location: v.location,
                extra_copies: v.extra_copies,
                bought_at: v.bought_at,
                isbn: v.isbn,
                created_on: Some(v.created_on),
                modified_on: Some(v.modified_on),
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
                created_on: Some(c.created_on),
                modified_on: Some(c.modified_on),
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
            publisher: row.publisher,
            edition: row.edition,
            review: row.review,
            review_public: row.review_public,
            created_on: Some(row.created_on),
            modified_on: Some(row.modified_on),
            reading_status: row.reading_status,
            started_reading_at: row.started_reading_at,
            finished_reading_at: row.finished_reading_at,
            times_read: row.times_read,
            author: row
                .author_id
                .and_then(|id| author_names.get(&id))
                .map(|a| a.name.clone()),
            genres,
            volumes_detail: vols,
            coffrets,
        });
    }
    library.sort_by_key(|a| a.name.to_lowercase());

    // 預け · The loan ledger, oldest first, keyed by the series id the
    // bundle uses (the importer re-maps it like every volume).
    let locations = crate::services::locations::all_for_export(db, user.id)
        .await?
        .into_iter()
        .map(|l| ExportLocation {
            name: l.name,
            note: l.note,
            position: l.position,
        })
        .collect();
    let loan_history = crate::services::loan_history::all_for_export(db, user.id)
        .await?
        .into_iter()
        .map(|h| ExportLoan {
            mal_id: h.mal_id,
            vol_num: h.vol_num,
            series_name: h.series_name,
            borrower: h.borrower,
            borrower_slug: h.borrower_slug,
            loaned_at: h.loaned_at,
            due_at: h.due_at,
            returned_at: h.returned_at,
        })
        .collect();

    Ok(ExportBundle {
        version: EXPORT_VERSION,
        exported_at: Utc::now(),
        source: "MangaCollector".into(),
        user: ExportUser {
            name: user.name.clone(),
        },
        settings,
        library,
        loan_history,
        locations,
    })
}

/// Flatten the whole archive into CSV rows — one line per volume of
/// every series (so a collector can open the file in a spreadsheet and
/// sort/pivot freely). Returns the raw CSV text including the header.
pub fn build_export_csv(bundle: &ExportBundle) -> String {
    let mut out = String::new();
    out.push_str(
        "mal_id,series,vol_num,owned,collector,read_at,price,store,notes,genres\n",
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
                "{mal},{name},,,,,,,,{genres}\n"
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
            let notes = csv_escape(v.notes.as_deref().unwrap_or(""));
            out.push_str(&format!(
                "{mal},{name},{vol},{owned},{collector},{read},{price},{store},{notes},{genres}\n",
                vol = v.vol_num,
                owned = v.owned,
                collector = v.collector,
            ));
        }
    }
    out
}

/// CSV-escape a single field: neutralise spreadsheet formula injection,
/// then wrap in double quotes if it contains comma, quote, CR or LF;
/// double any embedded quotes.
///
/// 防 · Formula-injection guard (CSV/CWE-1236): Excel / Sheets / Calc
/// evaluate a cell that begins with `=`, `+`, `@`, or a leading TAB/CR
/// as a formula, and `-` too unless it's a plain negative number. Series
/// names, store, and notes are fully user-controlled, so a value like
/// `=HYPERLINK(...)` or `=cmd|'/c calc'!A1` would execute when the
/// exported CSV is opened. We prefix such fields with a single quote so
/// the spreadsheet renders them literally. `-` followed by a digit/`.`
/// is left intact so legitimate negative numbers survive.
pub(crate) fn csv_escape(s: &str) -> String {
    let guarded = if starts_like_formula(s) {
        format!("'{s}")
    } else {
        s.to_string()
    };
    let needs_quote = guarded.contains(',')
        || guarded.contains('"')
        || guarded.contains('\n')
        || guarded.contains('\r');
    if !needs_quote {
        return guarded;
    }
    let escaped = guarded.replace('"', "\"\"");
    format!("\"{}\"", escaped)
}

/// True when `s` would be interpreted as a formula by a spreadsheet.
fn starts_like_formula(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some('=') | Some('+') | Some('@') | Some('\t') | Some('\r') => true,
        // `-5` / `-3.2` are legit negative numbers; `-=…` / `-cmd` aren't.
        Some('-') => !matches!(chars.next(), Some(c) if c.is_ascii_digit() || c == '.'),
        _ => false,
    }
}

/// 預け · Import the bundle's ledger rows of one series onto its live id.
/// A linked borrower is re-attached by slug under the same follow rule as
/// volumes; `replace` rewrites rows the backup knows, merge only adds.
async fn import_series_history(
    txn: &impl ConnectionTrait,
    user_id: i32,
    bundle: &ExportBundle,
    bundle_mal: i32,
    live_mal: i32,
    replace: bool,
    borrower_by_slug: &HashMap<String, i32>,
) -> Result<(), AppError> {
    for h in bundle
        .loan_history
        .iter()
        .filter(|h| h.mal_id == bundle_mal)
    {
        let borrower_user_id = h
            .borrower_slug
            .as_deref()
            .and_then(|s| borrower_by_slug.get(s).copied());
        let slug = borrower_user_id.and(h.borrower_slug.clone());
        crate::services::loan_history::import_row(
            txn,
            user_id,
            &crate::services::loan_history::ImportedLoan {
                mal_id: live_mal,
                vol_num: h.vol_num,
                series_name: &h.series_name,
                borrower: &h.borrower,
                borrower_user_id,
                borrower_slug: slug,
                loaned_at: h.loaned_at,
                due_at: h.due_at,
                returned_at: h.returned_at,
            },
            replace,
        )
        .await?;
    }
    Ok(())
}

/// 友 · Slug → user id for every linked borrower in the bundle, kept
/// only where the importing user follows that account.
async fn resolve_borrowers(
    db: &Db,
    user_id: i32,
    bundle: &ExportBundle,
) -> Result<HashMap<String, i32>, AppError> {
    let mut slugs: Vec<&str> = bundle
        .library
        .iter()
        .flat_map(|s| s.volumes_detail.iter())
        .filter_map(|v| v.loaned_to_slug.as_deref())
        .collect();
    slugs.sort_unstable();
    slugs.dedup();
    if slugs.is_empty() {
        return Ok(HashMap::new());
    }
    let users = UserEntity::find()
        .filter(user_mod::Column::PublicSlug.is_in(slugs.iter().map(|s| s.to_string())))
        .all(db)
        .await
        .map_err(AppError::from)?;
    let ids: Vec<i32> = users.iter().map(|u| u.id).collect();
    let followed: std::collections::HashSet<i32> = FollowEntity::find()
        .filter(follow::Column::FollowerId.eq(user_id))
        .filter(follow::Column::FollowingId.is_in(ids))
        .all(db)
        .await
        .map_err(AppError::from)?
        .into_iter()
        .map(|f| f.following_id)
        .collect();
    Ok(users
        .into_iter()
        .filter(|u| followed.contains(&u.id))
        .filter_map(|u| Some((u.public_slug?, u.id)))
        .collect())
}

/// How a bundle series is matched against one already in the library.
///
/// MAL series share a global id. MangaDex series carry the MangaDex
/// UUID. Anything else is a hand-made entry whose only identity is its
/// title (case- and whitespace-insensitive). A negative `mal_id` is
/// never an identity: it comes from a per-instance sequence, so the same
/// MangaDex series has a different one in every library — matching on
/// it made re-importing your own backup duplicate every non-MAL series.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum SeriesKey {
    Mal(i32),
    MangaDex(String),
    Custom(String),
}

fn series_key(mal_id: Option<i32>, mangadex_id: Option<&str>, name: &str) -> SeriesKey {
    match (mal_id, mangadex_id) {
        (Some(m), _) if m > 0 => SeriesKey::Mal(m),
        (_, Some(md)) if crate::util::uuid::is_canonical_uuid(md) => {
            SeriesKey::MangaDex(md.to_ascii_lowercase())
        }
        _ => SeriesKey::Custom(
            name.split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase(),
        ),
    }
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
    mode: ImportMode,
) -> Result<ImportPreview, AppError> {
    // Version gate — reject unknown schemas outright.
    if bundle.version > EXPORT_VERSION {
        return Err(AppError::BadRequest(format!(
            "Unknown export version {} (supported up to {}).",
            bundle.version, EXPORT_VERSION
        )));
    }

    // Pre-fetch the current library once and index it by identity so
    // conflicts are detected without a query per series. The value is
    // the LIVE row's mal_id — for a custom series that is the negative
    // id this instance minted, which is what the replace path has to
    // delete (and hand back to the re-inserted row), not whatever id
    // the bundle carries.
    let mut existing: HashMap<SeriesKey, i32> = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user.id))
        .all(db)
        .await
        .map_err(AppError::from)?
        .into_iter()
        .filter_map(|r| {
            let mal = r.mal_id?;
            Some((series_key(r.mal_id, r.mangadex_id.as_deref(), &r.name), mal))
        })
        .collect();

    let mut preview = ImportPreview {
        total_in_file: bundle.library.len(),
        ..Default::default()
    };

    // 友 · Re-link borrowers by public slug — only users who exist here
    // AND whom the importer follows, the rule the live lend path applies,
    // so a crafted bundle can't pin a loan on a stranger. Unresolved
    // slugs keep the text handle and lose the link.
    let borrower_by_slug = resolve_borrowers(db, user.id, bundle).await?;

    // 一括 · Wrap every write in a single transaction. A failure mid-
    // bundle (DB blip, broken row, unique-index conflict on a custom
    // mal_id) used to leave a half-imported library + orphan volumes/
    // coffrets committed; rolling back the txn keeps the state
    // consistent. For dry_run we still open a txn — the cost of an
    // empty BEGIN/ROLLBACK is negligible and the code path is simpler
    // without a `Option<DatabaseTransaction>` branch.
    let txn = db.begin().await.map_err(AppError::from)?;

    for series in &bundle.library {
        if series.name.trim().is_empty() || series.volumes < 0 {
            preview.skipped_invalid += 1;
            continue;
        }
        // Conflict: the bundle's series is already in the library (same
        // MAL id, same MangaDex UUID, or same custom title — see
        // `series_key`). Merge leaves the live series alone; replace
        // swaps it for the bundle's version — volumes and coffrets too —
        // inside this same transaction, then falls through to the insert
        // path below as if it were new.
        let key = series_key(series.mal_id, series.mangadex_id.as_deref(), &series.name);
        let existing_mal = existing.get(&key).copied();
        let conflict = existing_mal.is_some();
        if conflict && mode == ImportMode::Merge {
            preview.skipped_conflict += 1;
            preview.conflict_series.push(ImportAddedSummary {
                mal_id: series.mal_id,
                name: series.name.clone(),
                volumes: series.volumes,
                owned_volumes: series.volumes_detail.iter().filter(|v| v.owned).count(),
            });
            // 預け · A skipped series can still bring loans the live one
            // never recorded (a library kept before the ledger existed):
            // merge them, never overwrite what is there.
            if !dry_run && let (Some(bundle_mal), Some(live)) = (series.mal_id, existing_mal) {
                import_series_history(
                    &txn,
                    user.id,
                    bundle,
                    bundle_mal,
                    live,
                    false,
                    &borrower_by_slug,
                )
                .await?;
            }
            continue;
        }
        if let Some(live_mal) = existing_mal {
            preview.replaced += 1;
            if !dry_run {
                let mal = live_mal;
                crate::services::volume::delete_all_for_user_by_mal_id_tx(&txn, user.id, mal)
                    .await?;
                CoffretEntity::delete_many()
                    .filter(coffret::Column::UserId.eq(user.id))
                    .filter(coffret::Column::MalId.eq(mal))
                    .exec(&txn)
                    .await
                    .map_err(AppError::from)?;
                LibraryEntity::delete_many()
                    .filter(library::Column::UserId.eq(user.id))
                    .filter(library::Column::MalId.eq(mal))
                    .exec(&txn)
                    .await
                    .map_err(AppError::from)?;
            }
        } else {
            preview.added += 1;
        }
        let owned_count = series
            .volumes_detail
            .iter()
            .filter(|v| v.owned)
            .count();
        let summary = ImportAddedSummary {
            mal_id: series.mal_id,
            name: series.name.clone(),
            volumes: series.volumes,
            owned_volumes: owned_count,
        };
        // A replaced series is listed with the conflicts (the client
        // titles that list "will be replaced"), so `added_series` keeps
        // meaning "was not in the library before".
        if conflict {
            preview.conflict_series.push(summary);
        } else {
            preview.added_series.push(summary);
        }

        // A later copy of the same series in this bundle conflicts with
        // the row this iteration writes (or would write, in a dry run).
        existing
            .entry(key.clone())
            .or_insert(series.mal_id.unwrap_or_default());

        if dry_run {
            continue;
        }

        // Persist — library row first, then volumes, then coffrets.
        let assigned_mal = match series.mal_id {
            Some(m) if m > 0 => Some(m),
            // A replaced custom series keeps the negative id it already
            // had, so activity rows and snapshots that point at it stay
            // attached. A new one gets an id minted from the same Postgres
            // sequence every live add path uses, so an import can never
            // collide with a later custom add — the previous MIN(mal_id)-1
            // scheme could. Imported negative ids are never honoured:
            // they are meaningless across instances.
            _ => Some(match existing_mal {
                Some(live) => live,
                None => crate::services::library::mint_next_custom_mal_id(&txn, user.id).await?,
            }),
        };
        existing.insert(key, assigned_mal.unwrap_or_default());

        // Author is exported as text; resolve it the way the edit form
        // does (find or create in the shared table, scoped by user).
        let author_id = match series.author.as_deref() {
            Some(name) if !name.trim().is_empty() => {
                crate::services::author::resolve_author_from_text_tx(&txn, user.id, name).await?
            }
            _ => None,
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
            publisher: Set(series.publisher.clone()),
            edition: Set(series.edition.clone()),
            review: Set(series.review.clone()),
            review_public: Set(series.review_public),
            author_id: Set(author_id),
            genres: Set(if genres_str.is_empty() {
                None
            } else {
                Some(genres_str)
            }),
            // Gate the bundle-supplied mangadex_id behind the same
            // canonical-UUID check the live add-paths enforce. Other
            // code relies on "mangadex_id is always a UUID" (it flows
            // into MangaDex cover/metadata fetches); an import bundle
            // is fully attacker-authored, so a malformed value would
            // break that invariant. Drop it (keep the series, lose the
            // cross-link) rather than failing the whole import.
            mangadex_id: Set(series
                .mangadex_id
                .as_deref()
                .filter(|id| crate::util::uuid::is_canonical_uuid(id))
                .map(str::to_string)),
            // Bundle timestamps win: a restore must not turn every
            // series into "added today". v1 bundles have none → now.
            created_on: Set(series.created_on.unwrap_or(now)),
            modified_on: Set(series.modified_on.unwrap_or(now)),
            // A bundle is attacker-authored: an unknown status is
            // dropped rather than failing the whole import.
            reading_status: Set(crate::models::library::normalize_reading_status(
                series.reading_status.clone(),
            )
            .unwrap_or(None)),
            started_reading_at: Set(series.started_reading_at),
            finished_reading_at: Set(series.finished_reading_at),
            times_read: Set(series.times_read.max(0)),
            ..Default::default()
        };
        lib_active.insert(&txn).await.map_err(AppError::from)?;

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
        // 一括 · Volumes & coffrets are batched via `insert_many` —
        // a long series with `series_volumes_detail` carrying 200
        // tomes used to fire 200 round-trips through SeaORM; a single
        // multi-row INSERT slashes that to one. Postgres' parameter
        // limit is 65535 per statement: at ~10 columns per volume,
        // we'd hit that ceiling around 6500 rows — the per-series
        // ceiling is `clamp_volumes` = 10 000, so we chunk in batches
        // of 500 to stay comfortably below the limit while keeping
        // each statement's plan cache hot.
        const BULK_INSERT_CHUNK: usize = 500;

        let volume_models: Vec<volume_mod::ActiveModel> = if !series.volumes_detail.is_empty() {
            series
                .volumes_detail
                .iter()
                .map(|v| volume_mod::ActiveModel {
                    user_id: Set(user.id),
                    mal_id: Set(assigned_mal),
                    vol_num: Set(v.vol_num),
                    owned: Set(v.owned),
                    price: Set(v.price),
                    store: Set(v.store.clone()),
                    collector: Set(v.collector),
                    read_at: Set(v.read_at),
                    notes: Set(v.notes.clone()),
                    release_date: Set(v.release_date),
                    release_isbn: Set(v.release_isbn.clone()),
                    release_url: Set(v.release_url.clone()),
                    // `None` keeps the column's DB default ('manual').
                    origin: match &v.origin {
                        Some(o) => Set(o.clone()),
                        None => sea_orm::ActiveValue::NotSet,
                    },
                    announced_at: Set(v.announced_at),
                    loaned_to: Set(v.loaned_to.clone()),
                    loan_started_at: Set(v.loan_started_at),
                    loan_due_at: Set(v.loan_due_at),
                    loaned_to_user_id: Set(v
                        .loaned_to_slug
                        .as_deref()
                        .and_then(|s| borrower_by_slug.get(s).copied())),
                    // Attacker-authored bundle: an unknown grade is dropped,
                    // the copies count is clamped like the live path.
                    condition: Set(
                        crate::models::volume::normalize_condition(v.condition.clone())
                            .unwrap_or(None),
                    ),
                    location: Set(v.location.clone()),
                    extra_copies: Set(v
                        .extra_copies
                        .clamp(0, crate::models::volume::EXTRA_COPIES_MAX)),
                    bought_at: Set(v.bought_at),
                    isbn: Set(v
                        .isbn
                        .as_deref()
                        .and_then(crate::util::isbn::normalize_isbn13)),
                    created_on: Set(v.created_on.unwrap_or(now)),
                    modified_on: Set(v.modified_on.unwrap_or(now)),
                    ..Default::default()
                })
                .collect()
        } else if series_volumes > 0 {
            let owned_up_to = series_volumes_owned;
            (1..=series_volumes)
                .map(|vol_num| volume_mod::ActiveModel {
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
                })
                .collect()
        } else {
            Vec::new()
        };

        for chunk in volume_models.chunks(BULK_INSERT_CHUNK) {
            VolumeEntity::insert_many(chunk.to_vec())
                .exec(&txn)
                .await
                .map_err(AppError::from)?;
        }

        // Coffrets — inserted one by one so each new serial id can be
        // written back onto its member volumes: membership is restored
        // by range, the same rule the live create path applies. (v1 left
        // volumes unlinked and the page could not group them.)
        for c in &series.coffrets {
            let row = coffret::ActiveModel {
                user_id: Set(user.id),
                mal_id: Set(assigned_mal.unwrap_or(0)),
                name: Set(c.name.clone()),
                vol_start: Set(c.vol_start),
                vol_end: Set(c.vol_end),
                price: Set(c.price),
                store: Set(c.store.clone()),
                created_on: Set(c.created_on.unwrap_or(now)),
                modified_on: Set(c.modified_on.unwrap_or(now)),
                ..Default::default()
            }
            .insert(&txn)
            .await
            .map_err(AppError::from)?;
            VolumeEntity::update_many()
                .filter(volume_mod::Column::UserId.eq(user.id))
                .filter(volume_mod::Column::MalId.eq(assigned_mal.unwrap_or(0)))
                .filter(volume_mod::Column::VolNum.gte(c.vol_start))
                .filter(volume_mod::Column::VolNum.lte(c.vol_end))
                .col_expr(volume_mod::Column::CoffretId, row.id.into())
                .exec(&txn)
                .await
                .map_err(AppError::from)?;
        }

        // 預け · Loans: the bundle's ledger rows for this series (mapped
        // onto the live id), then every lent volume just written gets
        // its open row re-attached — or opened, for a bundle that
        // predates the ledger.
        let live_mal = assigned_mal.unwrap_or(0);
        if let Some(bundle_mal) = series.mal_id {
            import_series_history(
                &txn,
                user.id,
                bundle,
                bundle_mal,
                live_mal,
                mode == ImportMode::Replace,
                &borrower_by_slug,
            )
            .await?;
        }
        let lent = VolumeEntity::find()
            .filter(volume_mod::Column::UserId.eq(user.id))
            .filter(volume_mod::Column::MalId.eq(live_mal))
            .filter(volume_mod::Column::LoanedTo.is_not_null())
            .all(&txn)
            .await
            .map_err(AppError::from)?;
        for v in lent {
            let relinked = crate::services::loan_history::relink_open(
                &txn, user.id, live_mal, v.vol_num, v.id,
            )
            .await?;
            if relinked == 0 {
                crate::services::loan_history::record_lend(
                    &txn,
                    &crate::services::loan_history::LendRecord {
                        user_id: user.id,
                        volume_id: v.id,
                        mal_id: v.mal_id,
                        vol_num: v.vol_num,
                        borrower: v.loaned_to.as_deref().unwrap_or(""),
                        borrower_user_id: v.loaned_to_user_id,
                        loaned_at: v.loan_started_at.unwrap_or(now),
                        due_at: v.loan_due_at,
                    },
                )
                .await?;
            }
        }
    }

    // 確 · Settle the transaction. Dry-run rolls back so the BEGIN
    // doesn't burn an unused commit slot in postgres' WAL; live
    // imports commit so the writes become visible to subsequent
    // queries (and to the realtime broadcast that fires after this
    // function returns).
    if dry_run {
        txn.rollback().await.map_err(AppError::from)?;
    } else {
        // 棚 · The registry: the bundle's rows first (note, order), then
        // every name a tome carries that no row names yet — a bundle
        // older than the registry only knows places through its tomes.
        crate::services::locations::import_rows(
            &txn,
            user.id,
            &bundle.locations,
            mode == ImportMode::Replace,
        )
        .await?;
        crate::services::locations::ensure_all_from_volumes(&txn, user.id).await?;
        txn.commit().await.map_err(AppError::from)?;
    }

    Ok(preview)
}

#[cfg(test)]
mod identity_tests {
    use super::*;

    const MD: &str = "32d76d19-8a05-4db0-9fc2-e0b0648fe9d0";

    #[test]
    fn a_positive_mal_id_is_the_identity_whatever_else_is_set() {
        assert_eq!(
            series_key(Some(13), Some(MD), "One Piece"),
            SeriesKey::Mal(13)
        );
    }

    #[test]
    fn a_negative_mal_id_is_not_an_identity() {
        // Minted per instance: the same MangaDex series carries a
        // different negative id in every library, so the UUID is the key.
        assert_eq!(
            series_key(Some(-7), Some(MD), "Berserk"),
            series_key(Some(-9), Some(MD), "Berserk")
        );
        assert_eq!(
            series_key(Some(-7), Some(MD), "Berserk"),
            SeriesKey::MangaDex(MD.to_string())
        );
    }

    #[test]
    fn a_malformed_mangadex_id_falls_back_to_the_title() {
        assert_eq!(
            series_key(None, Some("not-a-uuid"), "Berserk"),
            SeriesKey::Custom("berserk".into())
        );
    }

    #[test]
    fn custom_titles_match_loosely() {
        assert_eq!(
            series_key(None, None, "  Mon   Manga "),
            series_key(Some(-3), None, "mon manga")
        );
        assert_ne!(
            series_key(None, None, "Mon Manga"),
            series_key(None, None, "Mon Manga 2")
        );
    }
}
