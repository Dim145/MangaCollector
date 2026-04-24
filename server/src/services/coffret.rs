use chrono::Utc;
use rust_decimal::Decimal;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};

use crate::db::Db;
use crate::errors::AppError;
use crate::models::coffret::{
    self, ActiveModel, Coffret, CreateCoffretRequest, Entity as CoffretEntity,
    UpdateCoffretRequest,
};
use crate::models::volume::{self, Entity as VolumeEntity};

pub async fn list_for_manga(
    db: &Db,
    user_id: i32,
    mal_id: i32,
) -> Result<Vec<Coffret>, AppError> {
    CoffretEntity::find()
        .filter(coffret::Column::UserId.eq(user_id))
        .filter(coffret::Column::MalId.eq(mal_id))
        .order_by_asc(coffret::Column::VolStart)
        .all(db)
        .await
        .map_err(AppError::from)
}

/// Create a coffret and stamp its volumes in a single transaction.
///
/// Each volume in `[vol_start, vol_end]` is marked as owned, linked to the
/// new coffret, and receives a per-volume share of the total price
/// (`price / count`). If the caller sets `collector = true`, the flag is
/// propagated to each volume too.
pub async fn create(
    db: &Db,
    user_id: i32,
    mal_id: i32,
    req: &CreateCoffretRequest,
) -> Result<Coffret, AppError> {
    if req.vol_end < req.vol_start {
        return Err(AppError::BadRequest(
            "vol_end must be >= vol_start".into(),
        ));
    }
    // Guard against volume numbers the user shouldn't ever send — the
    // range check above rejects inverted windows but not individually
    // nonsensical bounds. Clamping here also protects the arithmetic
    // below: `(vol_end - vol_start + 1)` would overflow i32 if a
    // pathological input passes `vol_start = i32::MIN, vol_end = 0`.
    if req.vol_start < 1 || req.vol_end < 1 {
        return Err(AppError::BadRequest(
            "vol_start and vol_end must both be ≥ 1".into(),
        ));
    }
    const MAX_COFFRET_SIZE: i64 = crate::services::library::MAX_VOLUMES_PER_SERIES as i64;
    // i64 arithmetic on purpose: even with both bounds in [1, i32::MAX]
    // the subtraction can produce a number larger than i32::MAX. Cast
    // up before subtracting, then cap at MAX_COFFRET_SIZE.
    let count = i64::from(req.vol_end) - i64::from(req.vol_start) + 1;
    if count > MAX_COFFRET_SIZE {
        return Err(AppError::BadRequest(format!(
            "Coffret too large ({} volumes); maximum is {}",
            count, MAX_COFFRET_SIZE
        )));
    }

    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("coffret name is required".into()));
    }
    let per_volume_price: Option<Decimal> = req.price.and_then(|total| {
        let divisor = Decimal::from(count);
        if divisor.is_zero() {
            None
        } else {
            Some((total / divisor).round_dp(2))
        }
    });

    let now = Utc::now();
    let txn = db.begin().await.map_err(AppError::from)?;

    let new_row = ActiveModel {
        user_id: Set(user_id),
        mal_id: Set(mal_id),
        name: Set(name.to_string()),
        vol_start: Set(req.vol_start),
        vol_end: Set(req.vol_end),
        price: Set(req.price),
        store: Set(req.store.clone()),
        created_on: Set(now),
        modified_on: Set(now),
        ..Default::default()
    };
    let coffret_row = new_row.insert(&txn).await.map_err(AppError::from)?;

    // Mark every volume in the range as owned + linked to this coffret.
    // We only touch rows that already exist — missing vol_nums are silently
    // skipped (the series might not yet have those volume rows in the DB).
    let mut update = VolumeEntity::update_many()
        .filter(volume::Column::UserId.eq(user_id))
        .filter(volume::Column::MalId.eq(mal_id))
        .filter(volume::Column::VolNum.gte(req.vol_start))
        .filter(volume::Column::VolNum.lte(req.vol_end))
        .col_expr(volume::Column::Owned, true.into())
        .col_expr(volume::Column::CoffretId, coffret_row.id.into())
        .col_expr(volume::Column::ModifiedOn, now.into());

    if let Some(p) = per_volume_price {
        update = update.col_expr(volume::Column::Price, p.into());
    }
    if let Some(store) = &req.store {
        update = update.col_expr(volume::Column::Store, store.clone().into());
    }
    if req.collector {
        update = update.col_expr(volume::Column::Collector, true.into());
    }

    update.exec(&txn).await.map_err(AppError::from)?;

    txn.commit().await.map_err(AppError::from)?;

    Ok(coffret_row)
}

/// Delete a coffret. The FK on `user_volumes.coffret_id` is `ON DELETE SET
/// NULL`, so the volumes stay in place (still owned, just no longer grouped).
/// Only the owner can delete their own coffret.
pub async fn delete(db: &Db, user_id: i32, coffret_id: i32) -> Result<(), AppError> {
    let res = CoffretEntity::delete_many()
        .filter(coffret::Column::Id.eq(coffret_id))
        .filter(coffret::Column::UserId.eq(user_id))
        .exec(db)
        .await
        .map_err(AppError::from)?;

    if res.rows_affected == 0 {
        return Err(AppError::NotFound("coffret not found".into()));
    }
    Ok(())
}

/// Update a coffret's header metadata (name / price / store). The volume
/// range stays frozen — to change it, the client deletes and recreates.
/// Per-volume prices are NOT touched here (they live their own life on
/// user_volumes and may have drifted since the coffret was purchased).
pub async fn update_by_id(
    db: &Db,
    user_id: i32,
    coffret_id: i32,
    req: &UpdateCoffretRequest,
) -> Result<Coffret, AppError> {
    let existing = CoffretEntity::find()
        .filter(coffret::Column::Id.eq(coffret_id))
        .filter(coffret::Column::UserId.eq(user_id))
        .one(db)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound("coffret not found".into()))?;

    let mut active: ActiveModel = existing.into();
    if let Some(name) = &req.name {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(AppError::BadRequest("name cannot be empty".into()));
        }
        active.name = Set(trimmed.to_string());
    }
    if req.clear_price {
        active.price = Set(None);
    } else if let Some(p) = req.price {
        active.price = Set(Some(p));
    }
    if req.clear_store {
        active.store = Set(None);
    } else if let Some(s) = &req.store {
        let trimmed = s.trim();
        active.store = Set(if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        });
    }
    active.modified_on = Set(Utc::now());

    active.update(db).await.map_err(AppError::from)
}
