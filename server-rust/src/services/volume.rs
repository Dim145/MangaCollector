use chrono::Utc;
use rust_decimal::Decimal;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set,
};

use crate::db::Db;
use crate::errors::AppError;
use crate::models::activity::event_types;
use crate::models::library::{self as library_mod, Entity as LibraryEntity};
use crate::models::volume::{self, ActiveModel, Entity as VolumeEntity, Volume};
use crate::services::activity;

/// Return value for `update_by_id` — we keep a lightweight result so the
/// handler can respond "ok" even when the row no longer exists (idempotent
/// replay of a queued offline edit).
pub struct VolumeUpdateResult {
    pub affected: bool,
}

pub async fn get_all_for_user(db: &Db, user_id: i32) -> Result<Vec<Volume>, AppError> {
    VolumeEntity::find()
        .filter(volume::Column::UserId.eq(user_id))
        .all(db)
        .await
        .map_err(AppError::from)
}

pub async fn get_all_for_user_by_mal_id(
    db: &Db,
    user_id: i32,
    mal_id: i32,
) -> Result<Vec<Volume>, AppError> {
    VolumeEntity::find()
        .filter(volume::Column::UserId.eq(user_id))
        .filter(volume::Column::MalId.eq(mal_id))
        .all(db)
        .await
        .map_err(AppError::from)
}

pub async fn update_by_id(
    db: &Db,
    id: i32,
    owned: bool,
    price: Option<Decimal>,
    store: Option<String>,
) -> Result<VolumeUpdateResult, AppError> {
    let now = Utc::now();

    // Fetch the existing row upfront so we can detect an ownership change
    // (for activity logging) and still behave idempotently if it's gone.
    let existing = VolumeEntity::find_by_id(id)
        .one(db)
        .await
        .map_err(AppError::from)?;

    let res = VolumeEntity::update_many()
        .filter(volume::Column::Id.eq(id))
        .col_expr(volume::Column::Owned, owned.into())
        .col_expr(
            volume::Column::Price,
            price.map_or_else(
                || sea_orm::sea_query::Expr::value(Option::<Decimal>::None),
                sea_orm::sea_query::Expr::value,
            ),
        )
        .col_expr(
            volume::Column::Store,
            store.map_or_else(
                || sea_orm::sea_query::Expr::value(Option::<String>::None),
                sea_orm::sea_query::Expr::value,
            ),
        )
        .col_expr(volume::Column::ModifiedOn, now.into())
        .exec(db)
        .await
        .map_err(AppError::from)?;

    // Log ownership transitions only — price/store edits alone don't produce
    // an activity entry.
    if let Some(prev) = existing {
        if prev.owned != owned {
            let mal_id = prev.mal_id.unwrap_or(0);
            let series_name = LibraryEntity::find()
                .filter(library_mod::Column::UserId.eq(prev.user_id))
                .filter(library_mod::Column::MalId.eq(mal_id))
                .one(db)
                .await
                .ok()
                .flatten()
                .map(|r| r.name);

            activity::record(
                db,
                prev.user_id,
                if owned {
                    event_types::VOLUME_OWNED
                } else {
                    event_types::VOLUME_UNOWNED
                },
                Some(mal_id),
                Some(prev.vol_num),
                series_name,
                None,
            )
            .await;
        }
    }

    Ok(VolumeUpdateResult {
        affected: res.rows_affected > 0,
    })
}

pub async fn add_volume(db: &Db, user_id: i32, mal_id: i32, vol_num: i32) -> Result<Volume, AppError> {
    let now = Utc::now();
    let model = ActiveModel {
        created_on: Set(now),
        modified_on: Set(now),
        user_id: Set(user_id),
        mal_id: Set(Some(mal_id)),
        vol_num: Set(vol_num),
        owned: Set(false),
        price: Set(None),
        store: Set(Some(String::new())),
        ..Default::default()
    };
    model.insert(db).await.map_err(AppError::from)
}

pub async fn add_volume_tx(
    conn: &impl ConnectionTrait,
    user_id: i32,
    mal_id: i32,
    vol_num: i32,
) -> Result<(), AppError> {
    let now = Utc::now();
    let model = ActiveModel {
        created_on: Set(now),
        modified_on: Set(now),
        user_id: Set(user_id),
        mal_id: Set(Some(mal_id)),
        vol_num: Set(vol_num),
        owned: Set(false),
        price: Set(None),
        store: Set(Some(String::new())),
        ..Default::default()
    };
    model.insert(conn).await.map_err(AppError::from)?;
    Ok(())
}

pub async fn delete_all_for_user_by_mal_id(db: &Db, user_id: i32, mal_id: i32) -> Result<(), AppError> {
    VolumeEntity::delete_many()
        .filter(volume::Column::UserId.eq(user_id))
        .filter(volume::Column::MalId.eq(mal_id))
        .exec(db)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

pub async fn delete_all_for_user_by_mal_id_tx(
    conn: &impl ConnectionTrait,
    user_id: i32,
    mal_id: i32,
) -> Result<(), AppError> {
    VolumeEntity::delete_many()
        .filter(volume::Column::UserId.eq(user_id))
        .filter(volume::Column::MalId.eq(mal_id))
        .exec(conn)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

pub async fn remove_volume_by_num(
    db: &Db,
    user_id: i32,
    mal_id: i32,
    vol_num: i32,
) -> Result<(), AppError> {
    VolumeEntity::delete_many()
        .filter(volume::Column::UserId.eq(user_id))
        .filter(volume::Column::MalId.eq(mal_id))
        .filter(volume::Column::VolNum.eq(vol_num))
        .exec(db)
        .await
        .map_err(AppError::from)?;
    Ok(())
}
