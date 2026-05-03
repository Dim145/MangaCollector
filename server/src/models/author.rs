//! 作家 · Author / mangaka detail cache. Shared across users —
//! see migration 20260503100000_add_authors_table.sql for the
//! population contract.

use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// SeaORM rejects composite primary keys with one nullable column —
/// a synthetic `id` autoincrement carries the row identity instead.
/// The user-facing identity is `(user_id, mal_id)` enforced by the
/// two partial unique indexes from the migration.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "authors")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    /// NULL for the shared MAL cache, the owner's user_id for custom
    /// author rows. The shared/custom semantics are documented on the
    /// migration; the service layer always passes the caller's
    /// user_id and lets the WHERE clause pick the right scope.
    pub user_id: Option<i32>,
    pub mal_id: i32,
    pub name: String,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
    pub image_url: Option<String>,
    pub about: Option<String>,
    pub birthday: Option<DateTime<Utc>>,
    pub favorites: i32,
    pub mal_url: Option<String>,
    pub fetched_at: DateTime<Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

/// API response shape — what `GET /api/authors/{mal_id}` returns to
/// the SPA. Same fields as the DB model minus `fetched_at` (cache
/// metadata) plus the `is_custom` flag so the SPA can decide
/// whether to expose Edit / Delete affordances.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorDetail {
    pub mal_id: i32,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub given_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub family_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub about: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub birthday: Option<DateTime<Utc>>,
    pub favorites: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mal_url: Option<String>,
    /// True iff the row is a custom author owned by the requesting
    /// user (i.e. user_id matches and mal_id is negative). Drives
    /// the Edit / Delete UI on the AuthorPage.
    pub is_custom: bool,
}

impl From<Model> for AuthorDetail {
    fn from(m: Model) -> Self {
        AuthorDetail {
            mal_id: m.mal_id,
            name: m.name,
            given_name: m.given_name,
            family_name: m.family_name,
            image_url: m.image_url,
            about: m.about,
            birthday: m.birthday,
            favorites: m.favorites,
            mal_url: m.mal_url,
            is_custom: m.user_id.is_some(),
        }
    }
}

/// Maximum length for user-typed author free-text fields. 160 fits
/// double-credit names like "Story by X / Art by Y" and 4 000 is
/// roomy for a personal note while staying way under postgres'
/// effective TEXT limits.
pub const AUTHOR_NAME_MAX_LEN: usize = 160;
pub const AUTHOR_ABOUT_MAX_LEN: usize = 4000;

/// Body for `POST /api/authors` — create a custom author.
#[derive(Debug, Deserialize)]
pub struct CreateAuthorRequest {
    pub name: String,
    #[serde(default)]
    pub about: Option<String>,
}

/// Body for `PATCH /api/authors/{mal_id}` — update a custom author's
/// editable fields. Same Option-of-Option shape as the library
/// patch so the client can distinguish "leave alone" / "clear" /
/// "set" without ambiguity.
#[derive(Debug, Deserialize)]
pub struct UpdateAuthorRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub about: Option<Option<String>>,
}

/// Three-state deserializer for `Option<Option<String>>` — same
/// pattern as `library::deserialize_optional_field`. `omitted` →
/// `None`, `null` → `Some(None)`, `"value"` → `Some(Some("value"))`.
/// Lets the handler distinguish "leave the column alone" from "clear
/// the column".
fn deserialize_optional_field<'de, D>(
    de: D,
) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(de).map(Some)
}
