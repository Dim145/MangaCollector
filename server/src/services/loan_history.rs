//! 預け · The loan ledger. Every code path that lends, edits or returns a
//! tome must go through here, or the history silently misses that loan:
//! `set_loan` (lend / edit / return), the un-own auto-clear in
//! `update_by_id`, and the archive importer (which recreates open loans).
use chrono::{DateTime, Utc};
use sea_orm::sea_query::OnConflict;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect,
};

use crate::errors::AppError;
use crate::models::library::{self, Entity as LibraryEntity};
use crate::models::loan_history::{self, Entity as HistoryEntity, Model};
use crate::models::user::Entity as UserEntity;

/// Hard cap on the history listing — a personal ledger, not a data export.
pub const LIST_MAX: u64 = 500;

/// Series name as filed today, for the snapshot.
async fn series_name(
    db: &impl ConnectionTrait,
    user_id: i32,
    mal_id: Option<i32>,
) -> Result<String, AppError> {
    let Some(mal) = mal_id else {
        return Ok(String::new());
    };
    Ok(LibraryEntity::find()
        .filter(library::Column::UserId.eq(user_id))
        .filter(library::Column::MalId.eq(mal))
        .one(db)
        .await
        .map_err(AppError::from)?
        .map(|r| r.name)
        .unwrap_or_default())
}

async fn slug_of(
    db: &impl ConnectionTrait,
    user_id: Option<i32>,
) -> Result<Option<String>, AppError> {
    let Some(id) = user_id else { return Ok(None) };
    Ok(UserEntity::find_by_id(id)
        .one(db)
        .await
        .map_err(AppError::from)?
        .and_then(|u| u.public_slug))
}

/// What opening a ledger row needs to know.
#[derive(Debug, Clone)]
pub struct LendRecord<'a> {
    pub user_id: i32,
    pub volume_id: i32,
    pub mal_id: Option<i32>,
    pub vol_num: i32,
    pub borrower: &'a str,
    pub borrower_user_id: Option<i32>,
    pub loaned_at: DateTime<Utc>,
    pub due_at: Option<DateTime<Utc>>,
}

/// A tome just left the shelf: open a ledger row. Idempotent on
/// (user, series, tome, instant) through the unique index.
pub async fn record_lend(db: &impl ConnectionTrait, lend: &LendRecord<'_>) -> Result<(), AppError> {
    let row = loan_history::ActiveModel {
        user_id: Set(lend.user_id),
        volume_id: Set(Some(lend.volume_id)),
        mal_id: Set(lend.mal_id.unwrap_or(0)),
        vol_num: Set(lend.vol_num),
        series_name: Set(series_name(db, lend.user_id, lend.mal_id).await?),
        borrower: Set(lend.borrower.to_string()),
        borrower_user_id: Set(lend.borrower_user_id),
        borrower_slug: Set(slug_of(db, lend.borrower_user_id).await?),
        loaned_at: Set(lend.loaned_at),
        due_at: Set(lend.due_at),
        returned_at: Set(None),
        ..Default::default()
    };
    HistoryEntity::insert(row)
        .on_conflict(
            OnConflict::columns([
                loan_history::Column::UserId,
                loan_history::Column::MalId,
                loan_history::Column::VolNum,
                loan_history::Column::LoanedAt,
            ])
            .update_columns([
                loan_history::Column::VolumeId,
                loan_history::Column::Borrower,
                loan_history::Column::BorrowerUserId,
                loan_history::Column::BorrowerSlug,
                loan_history::Column::DueAt,
            ])
            .to_owned(),
        )
        .exec(db)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

/// The open loan of a volume was edited (borrower, due date): mirror it.
pub async fn update_open(
    db: &impl ConnectionTrait,
    volume_id: i32,
    borrower: &str,
    borrower_user_id: Option<i32>,
    due_at: Option<DateTime<Utc>>,
) -> Result<(), AppError> {
    let slug = slug_of(db, borrower_user_id).await?;
    HistoryEntity::update_many()
        .filter(loan_history::Column::VolumeId.eq(volume_id))
        .filter(loan_history::Column::ReturnedAt.is_null())
        .col_expr(loan_history::Column::Borrower, borrower.to_string().into())
        .col_expr(
            loan_history::Column::BorrowerUserId,
            sea_orm::sea_query::Expr::value(borrower_user_id),
        )
        .col_expr(
            loan_history::Column::BorrowerSlug,
            sea_orm::sea_query::Expr::value(slug),
        )
        .col_expr(
            loan_history::Column::DueAt,
            sea_orm::sea_query::Expr::value(due_at),
        )
        .exec(db)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

/// The tome is back (or was un-owned while lent): close its open row.
pub async fn close_open(
    db: &impl ConnectionTrait,
    volume_id: i32,
    returned_at: DateTime<Utc>,
) -> Result<(), AppError> {
    HistoryEntity::update_many()
        .filter(loan_history::Column::VolumeId.eq(volume_id))
        .filter(loan_history::Column::ReturnedAt.is_null())
        .col_expr(
            loan_history::Column::ReturnedAt,
            sea_orm::sea_query::Expr::value(Some(returned_at)),
        )
        .exec(db)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

/// Newest first, optionally one series only.
pub async fn list(
    db: &impl ConnectionTrait,
    user_id: i32,
    mal_id: Option<i32>,
    limit: u64,
) -> Result<Vec<Model>, AppError> {
    let mut q = HistoryEntity::find().filter(loan_history::Column::UserId.eq(user_id));
    if let Some(mal) = mal_id {
        q = q.filter(loan_history::Column::MalId.eq(mal));
    }
    q.order_by_desc(loan_history::Column::LoanedAt)
        .limit(limit.clamp(1, LIST_MAX))
        .all(db)
        .await
        .map_err(AppError::from)
}

/// Every row of a user, oldest first — what the archive exports.
pub async fn all_for_export(
    db: &impl ConnectionTrait,
    user_id: i32,
) -> Result<Vec<Model>, AppError> {
    HistoryEntity::find()
        .filter(loan_history::Column::UserId.eq(user_id))
        .order_by_asc(loan_history::Column::LoanedAt)
        .all(db)
        .await
        .map_err(AppError::from)
}

/// Re-attach the open row of a rebuilt volume (archive import): the old
/// row lost its `volume_id` when the previous copy was deleted.
pub async fn relink_open(
    db: &impl ConnectionTrait,
    user_id: i32,
    mal_id: i32,
    vol_num: i32,
    volume_id: i32,
) -> Result<u64, AppError> {
    let res = HistoryEntity::update_many()
        .filter(loan_history::Column::UserId.eq(user_id))
        .filter(loan_history::Column::MalId.eq(mal_id))
        .filter(loan_history::Column::VolNum.eq(vol_num))
        .filter(loan_history::Column::ReturnedAt.is_null())
        .col_expr(
            loan_history::Column::VolumeId,
            sea_orm::sea_query::Expr::value(Some(volume_id)),
        )
        .exec(db)
        .await
        .map_err(AppError::from)?;
    Ok(res.rows_affected)
}

/// One archived loan, as the bundle describes it, already mapped onto
/// the live series id and the live borrower account (if followed).
#[derive(Debug, Clone)]
pub struct ImportedLoan<'a> {
    pub mal_id: i32,
    pub vol_num: i32,
    pub series_name: &'a str,
    pub borrower: &'a str,
    pub borrower_user_id: Option<i32>,
    pub borrower_slug: Option<String>,
    pub loaned_at: DateTime<Utc>,
    pub due_at: Option<DateTime<Utc>>,
    pub returned_at: Option<DateTime<Utc>>,
}

/// Import one archived loan. `replace` upserts every field (a restore
/// rewrites the past as the backup had it); merge keeps what is there.
pub async fn import_row(
    db: &impl ConnectionTrait,
    user_id: i32,
    loan: &ImportedLoan<'_>,
    replace: bool,
) -> Result<(), AppError> {
    let row = loan_history::ActiveModel {
        user_id: Set(user_id),
        volume_id: Set(None),
        mal_id: Set(loan.mal_id),
        vol_num: Set(loan.vol_num),
        series_name: Set(loan.series_name.to_string()),
        borrower: Set(loan.borrower.to_string()),
        borrower_user_id: Set(loan.borrower_user_id),
        borrower_slug: Set(loan.borrower_slug.clone()),
        loaned_at: Set(loan.loaned_at),
        due_at: Set(loan.due_at),
        returned_at: Set(loan.returned_at),
        ..Default::default()
    };
    let key = [
        loan_history::Column::UserId,
        loan_history::Column::MalId,
        loan_history::Column::VolNum,
        loan_history::Column::LoanedAt,
    ];
    let conflict = if replace {
        OnConflict::columns(key)
            .update_columns([
                loan_history::Column::SeriesName,
                loan_history::Column::Borrower,
                loan_history::Column::BorrowerUserId,
                loan_history::Column::BorrowerSlug,
                loan_history::Column::DueAt,
                loan_history::Column::ReturnedAt,
            ])
            .to_owned()
    } else {
        OnConflict::columns(key).do_nothing().to_owned()
    };
    // `exec_without_returning` — DO NOTHING returns no row, which the
    // default `exec` (RETURNING id) reports as an error.
    HistoryEntity::insert(row)
        .on_conflict(conflict)
        .exec_without_returning(db)
        .await
        .map_err(AppError::from)?;
    Ok(())
}
