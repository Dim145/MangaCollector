use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set, TransactionTrait};
use std::sync::Arc;

use crate::db::Db;
use crate::errors::AppError;
use crate::models::activity::Entity as ActivityEntity;
use crate::models::coffret::Entity as CoffretEntity;
use crate::models::library::{self, Entity as LibraryEntity};
use crate::models::setting::Entity as SettingEntity;
use crate::models::user::{self, ActiveModel, Entity as UserEntity, User};
use crate::models::volume::Entity as VolumeEntity;
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
