use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// SeaORM entity — genres stored as comma-separated string in DB
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "user_libraries")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub created_on: chrono::NaiveDateTime,
    pub modified_on: chrono::NaiveDateTime,
    pub user_id: i32,
    pub mal_id: Option<i32>,
    pub name: String,
    pub volumes: i32,
    pub volumes_owned: i32,
    pub image_url_jpg: Option<String>,
    pub genres: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

/// API response shape — genres as Vec<String>
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryEntry {
    pub id: i32,
    pub created_on: chrono::NaiveDateTime,
    pub modified_on: chrono::NaiveDateTime,
    pub user_id: i32,
    pub mal_id: Option<i32>,
    pub name: String,
    pub volumes: i32,
    pub volumes_owned: i32,
    pub image_url_jpg: Option<String>,
    pub genres: Vec<String>,
}

impl From<Model> for LibraryEntry {
    fn from(row: Model) -> Self {
        let genres = row
            .genres
            .as_deref()
            .unwrap_or("")
            .split(',')
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect();

        LibraryEntry {
            id: row.id,
            created_on: row.created_on,
            modified_on: row.modified_on,
            user_id: row.user_id,
            mal_id: row.mal_id,
            name: row.name,
            volumes: row.volumes,
            volumes_owned: row.volumes_owned,
            image_url_jpg: row.image_url_jpg,
            genres,
        }
    }
}

/// Request body for adding a manga to the library
#[derive(Debug, Deserialize)]
pub struct AddLibraryRequest {
    pub mal_id: Option<i32>,
    pub name: String,
    pub volumes: i32,
    pub volumes_owned: Option<i32>,
    pub image_url_jpg: Option<String>,
    pub genres: Option<Vec<String>>,
}

/// Request body for a custom library entry
#[derive(Debug, Deserialize)]
pub struct AddCustomRequest {
    pub name: String,
    pub volumes: i32,
    pub volumes_owned: Option<i32>,
    pub genres: Option<Vec<String>>,
}

/// Request body for updating volume count
#[derive(Debug, Deserialize)]
pub struct UpdateVolumesRequest {
    pub volumes: i32,
}
