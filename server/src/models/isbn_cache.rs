//! 番 · Instance-wide cache of resolved ISBNs (see `services::isbn_resolver`).
use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "isbn_cache")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub isbn: String,
    pub found: bool,
    pub source: Option<String>,
    /// The resolved book as JSON (`IsbnBook`), NULL for a miss.
    pub payload: Option<String>,
    pub fetched_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
