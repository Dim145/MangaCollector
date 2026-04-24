//! 印鑑帳 — The ceremonial seal (hanko) journal.
//!
//! Each seal is a narrative milestone — not a points system. The catalog
//! below is the single source of truth for what can be earned; the client
//! carries the same codes and resolves them to i18n labels/descriptions.
//!
//! Evaluation is lazy: a client GET triggers a recomputation that grants
//! any newly-qualifying seals in a single idempotent INSERT. We do not
//! hook every library/volume mutation because seals are a self-reflective
//! feature (users visit them episodically) and the stat computation is
//! cheap enough that on-demand evaluation beats the maintenance cost of
//! scattered hook-calls across the codebase.

use chrono::Utc;
use sea_orm::{
    sea_query::OnConflict, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QuerySelect, Set,
};
use std::collections::HashSet;

use crate::db::Db;
use crate::errors::AppError;
use crate::models::coffret::{self, Entity as CoffretEntity};
use crate::models::library::{self, Entity as LibraryEntity};
use crate::models::user::{self, Entity as UserEntity};
use crate::models::user_seal::{self, ActiveModel, EarnedSeal, Entity as SealEntity, SealsResponse};
use crate::models::volume::{self, Entity as VolumeEntity};

/// A seal definition. `code` is the stable slug stored in the DB and shared
/// with the client. `kind` drives which stat is compared to `threshold`.
#[derive(Debug, Clone, Copy)]
struct SealDef {
    code: &'static str,
    kind: ThresholdKind,
    threshold: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ThresholdKind {
    /// Sum of owned volumes across all series (volume.owned == true).
    VolumesOwned,
    /// Number of series in the library (user_libraries rows).
    SeriesCount,
    /// Number of series where volumes_owned >= volumes (volumes > 0).
    CompleteSeries,
    /// Number of owned collector volumes (volume.owned && volume.collector).
    CollectorVolumes,
    /// Number of series where every owned volume is flagged collector
    /// (at least one owned).
    AllCollectorSeries,
    /// Number of coffret rows for this user.
    Coffrets,
    /// Distinct genres represented across the library (after trim + filter).
    DistinctGenres,
    /// Days since the user account was created.
    AccountAgeDays,
    /// Number of volumes with a non-null read_at timestamp.
    VolumesRead,
    /// Number of series where every volume is read (volumes > 0 and
    /// every position 1..=volumes has a read_at set).
    FullyReadSeries,
}

/// The authoritative catalog. Order here is **presentation order** for the
/// carnet — the client displays them in the same order the server lists
/// them, so a rearrangement here is also a visual rearrangement.
///
/// Do NOT remove a code once shipped — users may have earned it. Mark it
/// internal instead if needed.
///
/// Visibility note: `CATALOG` stays crate-private (no external caller
/// needs it — the public API is `evaluate_and_grant`). We drop the
/// `pub` keyword so its type `SealDef` can also stay private without
/// triggering the "more private than the item" lint.
const CATALOG: &[SealDef] = &[
    // ── 入 Débuts ────────────────────────────────────────────────
    SealDef { code: "first_volume",   kind: ThresholdKind::VolumesOwned,       threshold: 1 },
    SealDef { code: "first_series",   kind: ThresholdKind::SeriesCount,        threshold: 1 },
    SealDef { code: "first_complete", kind: ThresholdKind::CompleteSeries,     threshold: 1 },
    // ── 進 Progression volume ───────────────────────────────────
    SealDef { code: "volumes_10",     kind: ThresholdKind::VolumesOwned,       threshold: 10 },
    SealDef { code: "volumes_100",    kind: ThresholdKind::VolumesOwned,       threshold: 100 },
    SealDef { code: "volumes_500",    kind: ThresholdKind::VolumesOwned,       threshold: 500 },
    SealDef { code: "volumes_1000",   kind: ThresholdKind::VolumesOwned,       threshold: 1000 },
    // ── 書 Étagère (séries) ─────────────────────────────────────
    SealDef { code: "series_10",      kind: ThresholdKind::SeriesCount,        threshold: 10 },
    SealDef { code: "series_50",      kind: ThresholdKind::SeriesCount,        threshold: 50 },
    // ── 完 Complétion ───────────────────────────────────────────
    SealDef { code: "complete_5",     kind: ThresholdKind::CompleteSeries,     threshold: 5 },
    SealDef { code: "complete_25",    kind: ThresholdKind::CompleteSeries,     threshold: 25 },
    SealDef { code: "complete_100",   kind: ThresholdKind::CompleteSeries,     threshold: 100 },
    // ── 限 Collector ────────────────────────────────────────────
    SealDef { code: "first_collector",    kind: ThresholdKind::CollectorVolumes,     threshold: 1 },
    SealDef { code: "collector_10",       kind: ThresholdKind::CollectorVolumes,     threshold: 10 },
    SealDef { code: "collector_100",      kind: ThresholdKind::CollectorVolumes,     threshold: 100 },
    SealDef { code: "all_collector_1",    kind: ThresholdKind::AllCollectorSeries,   threshold: 1 },
    SealDef { code: "all_collector_10",   kind: ThresholdKind::AllCollectorSeries,   threshold: 10 },
    // ── 盒 Coffrets ─────────────────────────────────────────────
    SealDef { code: "first_coffret",  kind: ThresholdKind::Coffrets,           threshold: 1 },
    SealDef { code: "coffret_10",     kind: ThresholdKind::Coffrets,           threshold: 10 },
    // ── 彩 Diversité ────────────────────────────────────────────
    SealDef { code: "genres_5",       kind: ThresholdKind::DistinctGenres,     threshold: 5 },
    SealDef { code: "genres_15",      kind: ThresholdKind::DistinctGenres,     threshold: 15 },
    // ── 年 Ancienneté ───────────────────────────────────────────
    SealDef { code: "anniversary_1",  kind: ThresholdKind::AccountAgeDays,     threshold: 365 },
    SealDef { code: "anniversary_5",  kind: ThresholdKind::AccountAgeDays,     threshold: 1825 },
    // ── 読 Lecture ──────────────────────────────────────────────
    // Reading-axis seals, orthogonal to ownership. Thresholds mirror the
    // volumes_* scale so users can track a parallel progression of
    // "how much I've read" against "how much I've acquired".
    SealDef { code: "first_read",      kind: ThresholdKind::VolumesRead,      threshold: 1 },
    SealDef { code: "read_10",         kind: ThresholdKind::VolumesRead,      threshold: 10 },
    SealDef { code: "read_100",        kind: ThresholdKind::VolumesRead,      threshold: 100 },
    SealDef { code: "read_500",        kind: ThresholdKind::VolumesRead,      threshold: 500 },
    SealDef { code: "read_1000",       kind: ThresholdKind::VolumesRead,      threshold: 1000 },
    SealDef { code: "first_full_read", kind: ThresholdKind::FullyReadSeries,  threshold: 1 },
    SealDef { code: "full_read_10",    kind: ThresholdKind::FullyReadSeries,  threshold: 10 },
    SealDef { code: "full_read_50",    kind: ThresholdKind::FullyReadSeries,  threshold: 50 },
];

/// Stats snapshot for a single user. Computed in one pass per request.
#[derive(Debug, Default)]
struct Stats {
    volumes_owned: i64,
    series_count: i64,
    complete_series: i64,
    collector_volumes: i64,
    all_collector_series: i64,
    coffrets: i64,
    distinct_genres: i64,
    account_age_days: i64,
    /// Total volumes the user has marked as read (read_at is NOT NULL).
    volumes_read: i64,
    /// Series where every volume 1..=library.volumes is read.
    fully_read_series: i64,
}

impl Stats {
    fn value_for(&self, kind: ThresholdKind) -> i64 {
        match kind {
            ThresholdKind::VolumesOwned => self.volumes_owned,
            ThresholdKind::SeriesCount => self.series_count,
            ThresholdKind::CompleteSeries => self.complete_series,
            ThresholdKind::CollectorVolumes => self.collector_volumes,
            ThresholdKind::AllCollectorSeries => self.all_collector_series,
            ThresholdKind::Coffrets => self.coffrets,
            ThresholdKind::DistinctGenres => self.distinct_genres,
            ThresholdKind::AccountAgeDays => self.account_age_days,
            ThresholdKind::VolumesRead => self.volumes_read,
            ThresholdKind::FullyReadSeries => self.fully_read_series,
        }
    }
}

/// Compute every stat needed by the catalog in one shot.
///
/// Reads: user row (for created_on), all library rows (for series counts,
/// complete flag, and genres), and all volume rows (for owned/collector
/// aggregates + per-series collector coherence). Coffret count comes from
/// its own small aggregate query.
async fn compute_stats(db: &Db, user_id: i32) -> Result<Stats, AppError> {
    let mut stats = Stats::default();

    // Account age — user.created_on → today.
    if let Some(u) = UserEntity::find_by_id(user_id)
        .select_only()
        .column(user::Column::CreatedOn)
        .into_tuple::<chrono::DateTime<chrono::Utc>>()
        .one(db)
        .await?
    {
        stats.account_age_days = (Utc::now() - u).num_days().max(0);
    }

    // Library sweep — series count, complete-series count, distinct genres.
    let libraries = LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .all(db)
        .await?;
    stats.series_count = libraries.len() as i64;
    let mut genres: HashSet<String> = HashSet::new();
    for row in &libraries {
        if row.volumes > 0 && row.volumes_owned >= row.volumes {
            stats.complete_series += 1;
        }
        if let Some(raw) = &row.genres {
            for g in raw.split(',') {
                let trimmed = g.trim();
                if !trimmed.is_empty() {
                    genres.insert(trimmed.to_lowercase());
                }
            }
        }
    }
    stats.distinct_genres = genres.len() as i64;

    // Volume sweep — owned total, collector owned, per-mal_id "all collector",
    // read volumes, and per-series read count (for fully-read qualifier).
    let volumes = VolumeEntity::find()
        .filter(volume::Column::UserId.eq(user_id))
        .all(db)
        .await?;
    use std::collections::HashMap;
    // Per-series bookkeeping: (owned, non_collector_owned, distinct_read_vols)
    let mut per_series: HashMap<i32, (i64, i64, HashSet<i32>)> = HashMap::new();
    for v in &volumes {
        if v.owned {
            stats.volumes_owned += 1;
            if v.collector {
                stats.collector_volumes += 1;
            }
            if let Some(mal) = v.mal_id {
                let e = per_series.entry(mal).or_default();
                e.0 += 1;
                if !v.collector {
                    e.1 += 1;
                }
            }
        }
        if v.read_at.is_some() {
            stats.volumes_read += 1;
            if let Some(mal) = v.mal_id {
                per_series.entry(mal).or_default().2.insert(v.vol_num);
            }
        }
    }
    stats.all_collector_series = per_series
        .values()
        .filter(|(owned, non_coll, _)| *owned > 0 && *non_coll == 0)
        .count() as i64;

    // Fully-read qualifier: series where every volume 1..=library.volumes is
    // marked read. Requires cross-referencing the library.volumes count
    // (published total) with the set of read vol_num we just collected.
    for row in &libraries {
        if row.volumes <= 0 {
            continue;
        }
        let mal = match row.mal_id {
            Some(m) => m,
            None => continue,
        };
        let read_set = match per_series.get(&mal) {
            Some((_, _, set)) => set,
            None => continue,
        };
        let all_read = (1..=row.volumes).all(|n| read_set.contains(&n));
        if all_read {
            stats.fully_read_series += 1;
        }
    }

    // Coffrets.
    stats.coffrets = CoffretEntity::find()
        .filter(coffret::Column::UserId.eq(user_id))
        .count(db)
        .await? as i64;

    Ok(stats)
}

/// Main entry point. Reads current stats, evaluates the catalog, grants any
/// newly-qualifying seals (INSERT ... ON CONFLICT DO NOTHING), and returns
/// the full carnet with the list of codes that were granted *this call*.
pub async fn evaluate_and_grant(db: &Db, user_id: i32) -> Result<SealsResponse, AppError> {
    let stats = compute_stats(db, user_id).await?;

    // Existing earnings — already-granted seals.
    let existing: Vec<(String, chrono::DateTime<chrono::Utc>)> = SealEntity::find()
        .filter(user_seal::Column::UserId.eq(user_id))
        .select_only()
        .column(user_seal::Column::SealCode)
        .column(user_seal::Column::EarnedAt)
        .into_tuple()
        .all(db)
        .await?;
    let already: HashSet<String> = existing.iter().map(|(c, _)| c.clone()).collect();

    // Figure out which catalog entries qualify but haven't been granted yet.
    let now = Utc::now();
    let mut newly: Vec<String> = Vec::new();
    for def in CATALOG {
        if already.contains(def.code) {
            continue;
        }
        if stats.value_for(def.kind) >= def.threshold {
            newly.push(def.code.to_string());
        }
    }

    // INSERT ... ON CONFLICT DO NOTHING. We do it in a single batch via SeaORM.
    if !newly.is_empty() {
        let rows: Vec<ActiveModel> = newly
            .iter()
            .map(|code| ActiveModel {
                user_id: Set(user_id),
                seal_code: Set(code.clone()),
                earned_at: Set(now),
            })
            .collect();
        // `insert_many` with `on_conflict` ignores dupes — safe if two
        // concurrent requests try to grant the same seal.
        SealEntity::insert_many(rows)
            .on_conflict(
                OnConflict::columns([user_seal::Column::UserId, user_seal::Column::SealCode])
                    .do_nothing()
                    .to_owned(),
            )
            .exec(db)
            .await
            .ok();
    }

    // Assemble the response — merge pre-existing + newly granted, oldest
    // first (so the carnet reads like a scroll).
    let mut earned: Vec<EarnedSeal> = existing
        .into_iter()
        .map(|(code, earned_at)| EarnedSeal { code, earned_at })
        .collect();
    for code in &newly {
        earned.push(EarnedSeal {
            code: code.clone(),
            earned_at: now,
        });
    }
    earned.sort_by_key(|s| s.earned_at);

    Ok(SealsResponse {
        earned,
        newly_granted: newly,
    })
}
