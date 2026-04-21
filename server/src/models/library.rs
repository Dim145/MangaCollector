use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// SeaORM entity — genres stored as comma-separated string in DB
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "user_libraries")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub created_on: chrono::DateTime<chrono::Utc>,
    pub modified_on: chrono::DateTime<chrono::Utc>,
    pub user_id: i32,
    pub mal_id: Option<i32>,
    pub name: String,
    pub volumes: i32,
    pub volumes_owned: i32,
    pub image_url_jpg: Option<String>,
    pub genres: Option<String>,
    /// MangaDex UUID when the entry was added from MangaDex or cross-linked
    /// during a merged search. Enables "refresh from MangaDex".
    pub mangadex_id: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

/// API response shape — genres as Vec<String>
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryEntry {
    pub id: i32,
    pub created_on: chrono::DateTime<chrono::Utc>,
    pub modified_on: chrono::DateTime<chrono::Utc>,
    pub user_id: i32,
    pub mal_id: Option<i32>,
    pub name: String,
    pub volumes: i32,
    pub volumes_owned: i32,
    pub image_url_jpg: Option<String>,
    pub genres: Vec<String>,
    pub mangadex_id: Option<String>,
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
            mangadex_id: row.mangadex_id,
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
    /// Optional MangaDex cross-reference. Present when the client picked a
    /// result that the merged search resolved against both sources.
    #[serde(default)]
    pub mangadex_id: Option<String>,
}

/// Request body for adding an entry sourced from MangaDex (no MAL id).
/// Mirrors the shape returned by `/api/external/search` so the client can
/// post the selected result back mostly as-is, plus the user-provided
/// volume count.
#[derive(Debug, Deserialize)]
pub struct AddFromMangadexRequest {
    pub mangadex_id: String,
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
