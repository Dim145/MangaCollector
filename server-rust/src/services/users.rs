use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};

use crate::db::Db;
use crate::errors::AppError;
use crate::models::user::{self, ActiveModel, Entity as UserEntity, User};

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
    let now = Utc::now().naive_utc();
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
