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
    /// Free-text publisher (Glénat, Viz, Kodansha…). Trimmed +
    /// length-clamped before persistence; empty string maps to None.
    pub publisher: Option<String>,
    /// Free-text edition variant (Standard, Kanzenban, Deluxe…). Same
    /// validation contract as `publisher`.
    pub edition: Option<String>,
}

/// Maximum byte length (after trim) for `publisher` / `edition`. Picked
/// to comfortably hold "Édition originale collector" or longest known
/// imprint names without letting a malicious client paste a megabyte.
pub const PUBLISHER_MAX_LEN: usize = 80;
pub const EDITION_MAX_LEN: usize = 60;

/// Per-genre length cap and per-row count cap, used by `sanitize_genres`.
/// 40 chars is roomy enough for "Slice of Life" or "Comédie romantique"
/// without letting a megabyte of "spam" land in the column. 30 entries
/// covers the broadest MAL series (Naruto stops at ~14) with headroom
/// for user customs without bloating the comma-string.
pub const GENRE_MAX_LEN: usize = 40;
pub const GENRES_MAX_COUNT: usize = 30;

/// Trim + length-clamp + empty-to-None. Returned `None` means "unset
/// the field"; returned `Some(_)` is guaranteed to be a non-empty
/// string of at most `max_len` chars. Length is measured in characters
/// (not bytes) so multi-byte UTF-8 (é, 限, …) doesn't count double.
pub fn sanitize_label(value: Option<String>, max_len: usize) -> Option<String> {
    let v = value?.trim().to_string();
    if v.is_empty() {
        return None;
    }
    let truncated: String = v.chars().take(max_len).collect();
    Some(truncated)
}

/// Same contract as `sanitize_label`, applied per entry, plus:
///   - drop empties
///   - dedup case-sensitive while preserving first-seen order
///   - clamp the total count to `GENRES_MAX_COUNT`
///
/// Returns the sanitized vector. Caller decides whether to persist as
/// the comma-joined `genres` column (`Vec::is_empty()` → empty string,
/// rendered as `Option::<String>::None` upstream).
pub fn sanitize_genres(values: Vec<String>) -> Vec<String> {
    // Pre-allocate the constant upper bound (`GENRES_MAX_COUNT`) rather
    // than `values.len().min(GENRES_MAX_COUNT)`. The two were
    // arithmetically equivalent — the loop below enforces the same cap
    // via `out.len() >= GENRES_MAX_COUNT` — but CodeQL's
    // `rust/uncontrolled-allocation-size` taint tracker doesn't propagate
    // `.min()` as a sink-side bound, so it flagged `values.len()` as a
    // user-controlled allocation size. Allocating the constant directly
    // removes the user-input source from the data flow entirely. Cost: a
    // few bytes of unused capacity when the input has fewer than 30
    // entries (the common case) — negligible vs. a Vec<String> reallocation.
    let mut out: Vec<String> = Vec::with_capacity(GENRES_MAX_COUNT);
    for raw in values {
        let trimmed: String = raw.trim().chars().take(GENRE_MAX_LEN).collect();
        if trimmed.is_empty() {
            continue;
        }
        if out.iter().any(|x| x == &trimmed) {
            continue;
        }
        out.push(trimmed);
        if out.len() >= GENRES_MAX_COUNT {
            break;
        }
    }
    out
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
    pub publisher: Option<String>,
    pub edition: Option<String>,
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
            publisher: row.publisher,
            edition: row.edition,
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
    /// Optional editorial metadata (publisher / edition variant) — the
    /// scan flow extracts these from Google Books and pre-fills them
    /// when first registering the series. Both run through
    /// `sanitize_label` server-side, so a pasted megabyte is clamped.
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub edition: Option<String>,
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

/// Request body for the `PATCH /library/:mal_id` endpoint.
///
/// Every field is optional and applied only when present, so a client
/// can update a single attribute (e.g. just the publisher) without
/// echoing back the whole row. `volumes` was the original — and only —
/// field; we kept the route shape and grew the body.
///
/// `publisher` / `edition` carry an `Option<String>`:
///   - field omitted → leave the column untouched
///   - `Some("")`    → unset (handled by `sanitize_label` before save)
///   - `Some(text)`  → trim + clamp to `PUBLISHER_MAX_LEN` / `EDITION_MAX_LEN`
#[derive(Debug, Deserialize)]
pub struct UpdateLibraryRequest {
    pub volumes: Option<i32>,
    /// Use `Option<Option<String>>` via custom serde so the client can
    /// distinguish "field absent" from "field present and explicitly
    /// null". In practice we treat `Some(None)` and `Some(Some(""))`
    /// identically: clear the column. `None` means "leave alone".
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub publisher: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub edition: Option<Option<String>>,
    /// Replace the whole genres list. Editing genres post-creation is
    /// only allowed for **custom rows** — i.e. `mal_id < 0` AND
    /// `mangadex_id IS NULL`. Rows that have either an upstream MAL or
    /// MangaDex link silently ignore this field, because letting the
    /// user diverge from upstream without an override-tracking schema
    /// would make the next `refresh-from-*` clobber the edits without
    /// warning. The handler enforces the gate.
    ///
    /// Three-state shape (`Option<Option<Vec<String>>>`) so the client
    /// can send `null` to clear all genres on a custom row.
    #[serde(default, deserialize_with = "deserialize_optional_genres")]
    pub genres: Option<Option<Vec<String>>>,
}

/// Three-state deserializer: omitted / null / value. Lets the handler
/// detect "the client wants to clear this column" (null) vs "the
/// client didn't touch this column" (omitted). Without it, both
/// collapse into `None` and we can't tell them apart.
fn deserialize_optional_field<'de, D>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(Some)
}

/// Same three-state pattern, but for the `genres` field which carries a
/// `Vec<String>` instead of a `String`.
fn deserialize_optional_genres<'de, D>(
    deserializer: D,
) -> Result<Option<Option<Vec<String>>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<Vec<String>>::deserialize(deserializer).map(Some)
}

