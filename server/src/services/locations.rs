//! 棚 · The places registry. `user_volumes.location` stays the tome's
//! pointer — a name, which is what the offline cache and the archive
//! already carry — and this module keeps the registry of names in step
//! with it: a place typed on a tome registers itself, renaming a place
//! moves every tome filed under it, deleting one unfiles them.
use chrono::{DateTime, Utc};
use sea_orm::sea_query::{Expr, OnConflict};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter,
    QueryOrder, QuerySelect,
};
use serde::{Deserialize, Serialize};

use crate::errors::AppError;
use crate::models::archive::ExportLocation;
use crate::models::library::sanitize_label;
use crate::models::location::{self, Entity as LocationEntity, Model};
use crate::models::volume::{self as volume_mod, Entity as VolumeEntity, LOCATION_MAX_LEN};

/// A note is a reminder ("top shelf, behind the lamp"), not an essay.
pub const NOTE_MAX_CHARS: usize = 500;

/// One place with how many owned tomes sit there.
#[derive(Debug, Clone, Serialize)]
pub struct LocationView {
    pub id: i64,
    pub name: String,
    pub note: Option<String>,
    pub position: i32,
    pub volumes: i64,
    pub created_on: DateTime<Utc>,
    pub modified_on: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocationsResponse {
    pub locations: Vec<LocationView>,
    /// Owned tomes with no place at all.
    pub unfiled: i64,
}

/// `PATCH` body. `note: Some("")` clears the note; a missing field is
/// left alone.
#[derive(Debug, Default, Deserialize)]
pub struct LocationPatch {
    pub name: Option<String>,
    pub note: Option<String>,
    pub position: Option<i32>,
}

fn clean_note(raw: Option<String>) -> Option<String> {
    let text = raw?.trim().to_string();
    if text.is_empty() {
        return None;
    }
    Some(text.chars().take(NOTE_MAX_CHARS).collect())
}

async fn find_by_name(
    db: &impl ConnectionTrait,
    user_id: i32,
    name: &str,
) -> Result<Option<Model>, AppError> {
    LocationEntity::find()
        .filter(location::Column::UserId.eq(user_id))
        .filter(location::Column::Name.eq(name))
        .one(db)
        .await
        .map_err(AppError::from)
}

async fn find_owned(db: &impl ConnectionTrait, user_id: i32, id: i64) -> Result<Model, AppError> {
    LocationEntity::find_by_id(id)
        .filter(location::Column::UserId.eq(user_id))
        .one(db)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound("Location not found".into()))
}

async fn next_position(db: &impl ConnectionTrait, user_id: i32) -> Result<i32, AppError> {
    let max: Option<i32> = LocationEntity::find()
        .select_only()
        .column_as(location::Column::Position.max(), "max_position")
        .filter(location::Column::UserId.eq(user_id))
        .into_tuple::<Option<i32>>()
        .one(db)
        .await
        .map_err(AppError::from)?
        .flatten();
    Ok(max.map(|m| m + 1).unwrap_or(0))
}

/// Register a place by name if it is not known yet. Returns the row, or
/// `None` when the name is blank. Safe to race: the unique index wins.
pub async fn ensure(
    db: &impl ConnectionTrait,
    user_id: i32,
    raw: &str,
) -> Result<Option<Model>, AppError> {
    let Some(name) = sanitize_label(Some(raw.to_string()), LOCATION_MAX_LEN) else {
        return Ok(None);
    };
    if let Some(existing) = find_by_name(db, user_id, &name).await? {
        return Ok(Some(existing));
    }
    let now = Utc::now();
    let row = location::ActiveModel {
        user_id: Set(user_id),
        name: Set(name.clone()),
        note: Set(None),
        position: Set(next_position(db, user_id).await?),
        created_on: Set(now),
        modified_on: Set(now),
        ..Default::default()
    };
    LocationEntity::insert(row)
        .on_conflict(
            OnConflict::columns([location::Column::UserId, location::Column::Name])
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(db)
        .await
        .map_err(AppError::from)?;
    find_by_name(db, user_id, &name).await
}

/// Every place, in display order, with its tome count — plus how many
/// owned tomes have no place yet.
pub async fn list(db: &impl ConnectionTrait, user_id: i32) -> Result<LocationsResponse, AppError> {
    let rows = LocationEntity::find()
        .filter(location::Column::UserId.eq(user_id))
        .order_by_asc(location::Column::Position)
        .order_by_asc(location::Column::Name)
        .all(db)
        .await
        .map_err(AppError::from)?;
    let counts: Vec<(Option<String>, i64)> = VolumeEntity::find()
        .select_only()
        .column(volume_mod::Column::Location)
        .column_as(volume_mod::Column::Id.count(), "n")
        .filter(volume_mod::Column::UserId.eq(user_id))
        .filter(volume_mod::Column::Owned.eq(true))
        .group_by(volume_mod::Column::Location)
        .into_tuple()
        .all(db)
        .await
        .map_err(AppError::from)?;
    let mut unfiled = 0i64;
    let mut by_name = std::collections::HashMap::new();
    for (name, n) in counts {
        match name.as_deref().map(str::trim) {
            Some(text) if !text.is_empty() => {
                by_name.insert(text.to_string(), n);
            }
            _ => unfiled += n,
        }
    }
    let locations = rows
        .into_iter()
        .map(|r| LocationView {
            volumes: by_name.get(&r.name).copied().unwrap_or(0),
            id: r.id,
            name: r.name,
            note: r.note,
            position: r.position,
            created_on: r.created_on,
            modified_on: r.modified_on,
        })
        .collect();
    Ok(LocationsResponse { locations, unfiled })
}

/// Create by name (or return the existing place), optionally with a note.
pub async fn create(
    db: &impl ConnectionTrait,
    user_id: i32,
    name: &str,
    note: Option<String>,
) -> Result<Model, AppError> {
    let row = ensure(db, user_id, name)
        .await?
        .ok_or_else(|| AppError::BadRequest("A place needs a name.".into()))?;
    match clean_note(note) {
        Some(text) if row.note.as_deref() != Some(text.as_str()) => {
            let mut active: location::ActiveModel = row.into();
            active.note = Set(Some(text));
            active.modified_on = Set(Utc::now());
            active.update(db).await.map_err(AppError::from)
        }
        _ => Ok(row),
    }
}

/// Rename, annotate or reorder. A rename moves every tome filed under
/// the old name; two places cannot share a name.
pub async fn update(
    db: &impl ConnectionTrait,
    user_id: i32,
    id: i64,
    patch: LocationPatch,
) -> Result<Model, AppError> {
    let row = find_owned(db, user_id, id).await?;
    let old_name = row.name.clone();
    let mut active: location::ActiveModel = row.into();
    if let Some(raw) = patch.name {
        let name = sanitize_label(Some(raw), LOCATION_MAX_LEN)
            .ok_or_else(|| AppError::BadRequest("A place needs a name.".into()))?;
        if name != old_name {
            if find_by_name(db, user_id, &name).await?.is_some() {
                return Err(AppError::Conflict(
                    "A place with that name already exists.".into(),
                ));
            }
            VolumeEntity::update_many()
                .col_expr(volume_mod::Column::Location, Expr::value(name.clone()))
                .filter(volume_mod::Column::UserId.eq(user_id))
                .filter(volume_mod::Column::Location.eq(old_name.as_str()))
                .exec(db)
                .await
                .map_err(AppError::from)?;
            active.name = Set(name);
        }
    }
    if let Some(raw) = patch.note {
        active.note = Set(clean_note(Some(raw)));
    }
    if let Some(position) = patch.position {
        active.position = Set(position.max(0));
    }
    active.modified_on = Set(Utc::now());
    active.update(db).await.map_err(AppError::from)
}

/// Delete a place; the tomes filed under it are unfiled, not touched
/// otherwise. Returns how many were unfiled.
pub async fn remove(db: &impl ConnectionTrait, user_id: i32, id: i64) -> Result<u64, AppError> {
    let row = find_owned(db, user_id, id).await?;
    let cleared = VolumeEntity::update_many()
        .col_expr(
            volume_mod::Column::Location,
            Expr::value(sea_orm::Value::String(None)),
        )
        .filter(volume_mod::Column::UserId.eq(user_id))
        .filter(volume_mod::Column::Location.eq(row.name.as_str()))
        .exec(db)
        .await
        .map_err(AppError::from)?
        .rows_affected;
    LocationEntity::delete_by_id(row.id)
        .exec(db)
        .await
        .map_err(AppError::from)?;
    Ok(cleared)
}

/// Registry rows for the archive bundle, in display order.
pub async fn all_for_export(
    db: &impl ConnectionTrait,
    user_id: i32,
) -> Result<Vec<Model>, AppError> {
    LocationEntity::find()
        .filter(location::Column::UserId.eq(user_id))
        .order_by_asc(location::Column::Position)
        .order_by_asc(location::Column::Name)
        .all(db)
        .await
        .map_err(AppError::from)
}

/// Bring the registry rows of a bundle in. A merge only fills what is
/// missing (new places, blank notes); a replace-restore takes the
/// bundle's note and order as truth.
pub async fn import_rows(
    db: &impl ConnectionTrait,
    user_id: i32,
    rows: &[ExportLocation],
    replace: bool,
) -> Result<(), AppError> {
    for entry in rows {
        let Some(name) = sanitize_label(Some(entry.name.clone()), LOCATION_MAX_LEN) else {
            continue;
        };
        // A place this import brings into existence takes the bundle's note
        // and order wholesale: there is nothing of the user's to protect.
        // One that was already here keeps them unless this is a restore.
        let fresh = find_by_name(db, user_id, &name).await?.is_none();
        let Some(existing) = ensure(db, user_id, &name).await? else {
            continue;
        };
        let note = clean_note(entry.note.clone());
        let take_note = replace || fresh || (existing.note.is_none() && note.is_some());
        let take_position = (replace || fresh) && existing.position != entry.position;
        if !take_note && !take_position {
            continue;
        }
        let mut active: location::ActiveModel = existing.into();
        if take_note {
            active.note = Set(note);
        }
        if take_position {
            active.position = Set(entry.position.max(0));
        }
        active.modified_on = Set(Utc::now());
        active.update(db).await.map_err(AppError::from)?;
    }
    Ok(())
}

/// Register every place currently typed on a tome — a bundle older than
/// the registry only carries names on volumes.
pub async fn ensure_all_from_volumes(
    db: &impl ConnectionTrait,
    user_id: i32,
) -> Result<(), AppError> {
    let names: Vec<Option<String>> = VolumeEntity::find()
        .select_only()
        .column(volume_mod::Column::Location)
        .distinct()
        .filter(volume_mod::Column::UserId.eq(user_id))
        .filter(volume_mod::Column::Location.is_not_null())
        .into_tuple()
        .all(db)
        .await
        .map_err(AppError::from)?;
    for name in names.into_iter().flatten() {
        ensure(db, user_id, &name).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notes_are_trimmed_cleared_and_capped() {
        assert_eq!(clean_note(None), None);
        assert_eq!(clean_note(Some("   ".into())), None);
        assert_eq!(
            clean_note(Some("  behind the lamp ".into())),
            Some("behind the lamp".into())
        );
        let long = "x".repeat(NOTE_MAX_CHARS + 40);
        assert_eq!(
            clean_note(Some(long)).unwrap().chars().count(),
            NOTE_MAX_CHARS
        );
    }
}
