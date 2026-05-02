use rust_decimal::Decimal;
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "user_volumes")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub created_on: chrono::DateTime<chrono::Utc>,
    pub modified_on: chrono::DateTime<chrono::Utc>,
    pub user_id: i32,
    pub mal_id: Option<i32>,
    pub vol_num: i32,
    pub owned: bool,
    pub price: Option<Decimal>,
    pub store: Option<String>,
    #[sea_orm(default)]
    pub collector: bool,
    #[sea_orm(default)]
    pub coffret_id: Option<i32>,
    /// First-read timestamp — NULL means unread (tsundoku if `owned`).
    /// Orthogonal to `owned`: a volume can be read without being owned
    /// (borrowed copy) or owned without being read (classic tsundoku).
    #[sea_orm(default)]
    pub read_at: Option<chrono::DateTime<chrono::Utc>>,

    // ── 来 · Upcoming-volume metadata ───────────────────────────────
    //
    // A volume with `release_date > NOW()` is "upcoming" — the rest
    // of the system enforces:
    //   - owned must be false
    //   - read_at must be NULL
    //   - collector must be false
    // The transition to "released" is implicit: once `release_date`
    // is in the past, the same predicate flips, no migration / job
    // is needed.
    /// Announced commercial release date for this tome. NULL = the
    /// volume is already out (or the source had no date).
    #[sea_orm(default)]
    pub release_date: Option<chrono::DateTime<chrono::Utc>>,
    /// ISBN-13 of the announced edition. Surfaces in the drawer and
    /// helps a future "scan on pickup" flow match the existing row
    /// rather than minting a new one.
    #[sea_orm(default)]
    pub release_isbn: Option<String>,
    /// Pre-order URL — typically the publisher's product page or a
    /// retailer (Amazon FR / FNAC / Bookwalker). Displayed as an
    /// outbound CTA in the upcoming-volume drawer.
    #[sea_orm(default)]
    pub release_url: Option<String>,
    /// Provenance of this row. `manual` = the user typed it in and
    /// the nightly sweep must leave it alone. Any of the API-source
    /// values (`mangaupdates`, `googlebooks`, `openlibrary`,
    /// `mangadex`) marks a row the sweep is allowed to refresh.
    #[sea_orm(default = "manual")]
    pub origin: String,
    /// When THIS server first persisted the announcement. Used by
    /// the UI to surface "Detected MMM dd" so the user can judge
    /// the data's freshness, and by the cancellation cleanup path
    /// (a stale upcoming row past its date by 14d gets removed).
    #[sea_orm(default)]
    pub announced_at: Option<chrono::DateTime<chrono::Utc>>,

    /// Personal note. Capped at NOTE_MAX_CHARS by the service layer.
    /// NULL means no note; the service normalises empty-after-trim
    /// strings to NULL on write.
    #[sea_orm(default)]
    pub notes: Option<String>,

    // ── 預ける Azuke · Loan tracker ──────────────────────────────────
    //
    // When `loaned_to` is NOT NULL the volume is currently with a
    // borrower. The triplet is overlay metadata over `owned` — a
    // lent tome is still owned (the user paid for it) but is OFF
    // the shelf. The service-layer invariant: loaned_to ↔ loan_started_at
    // (both set or both null). loan_due_at is independent.
    /// Free-text borrower handle. Capped at LOAN_BORROWER_MAX_CHARS
    /// by the service. NULL = not currently lent.
    #[sea_orm(default)]
    pub loaned_to: Option<String>,
    /// When the volume left the shelf. Set on lend, cleared on return.
    #[sea_orm(default)]
    pub loan_started_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Expected return date. NULL = open-ended ("just take it"). The
    /// dashboard widget surfaces overdue rows by comparing against
    /// NOW(); the service does not enforce.
    #[sea_orm(default)]
    pub loan_due_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

pub type Volume = Model;

/// Request body for updating a volume.
///
/// `read` is sent by the client as a plain boolean — the server maps it
/// to a timestamp (now) on the way in and exposes `read_at` on the way
/// out. Keeping the API boolean means clients don't need to reason about
/// the exact moment the mark was made.
#[derive(Debug, Deserialize)]
pub struct UpdateVolumeRequest {
    pub id: i32,
    pub owned: bool,
    pub price: Option<Decimal>,
    pub store: Option<String>,
    #[serde(default)]
    pub collector: bool,
    /// Reading status — `Some(true)` marks read (stamps read_at=now if
    /// not already set), `Some(false)` clears the timestamp, `None`
    /// leaves the field untouched. Defaults to None for partial updates.
    #[serde(default)]
    pub read: Option<bool>,
    /// `Some(text)` writes, `Some("")` clears (normalised to NULL),
    /// `None` leaves the existing note untouched.
    #[serde(default)]
    pub notes: Option<String>,
    /// 預け · Loan state mutation.
    ///   - `None` (omitted) → leave the loan triplet as-is
    ///   - `Some(None)` → clear the loan (volume returned)
    ///   - `Some(Some(LoanPatch { ... }))` → mark as lent / update due date
    #[serde(default, deserialize_with = "deserialize_optional_loan")]
    pub loan: Option<Option<LoanPatch>>,
}

#[derive(Debug, Deserialize)]
pub struct LoanPatch {
    /// Free-text borrower handle. Server trims + clamps to
    /// `LOAN_BORROWER_MAX_CHARS`; empty post-trim is rejected.
    pub to: String,
    /// Optional expected return date. Pass `null` for open-ended.
    #[serde(default)]
    pub due_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Three-state deserializer for the loan field — mirrors the
/// `Option<Option<T>>` pattern used on UpdateLibraryRequest.
/// Lets the handler distinguish "field absent" from "field present
/// and explicitly null".
fn deserialize_optional_loan<'de, D>(
    deserializer: D,
) -> Result<Option<Option<LoanPatch>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<LoanPatch>::deserialize(deserializer).map(Some)
}

pub const NOTE_MAX_CHARS: usize = 2000;
/// Cap on the borrower handle. 80 chars matches PUBLISHER_MAX_LEN —
/// roomy enough for a full name + venue ("Paul · book club Lyon")
/// without letting a megabyte of text into the column.
pub const LOAN_BORROWER_MAX_CHARS: usize = 80;

/// Response shape for the loan-listing endpoint. Joins the volume's
/// loan triplet with the parent series name so the dashboard widget
/// can render "Naoki · Tome 3 de Berserk" without a second query.
#[derive(Debug, Clone, Serialize)]
pub struct ActiveLoan {
    pub volume_id: i32,
    pub mal_id: Option<i32>,
    pub vol_num: i32,
    pub series_name: Option<String>,
    pub series_image_url: Option<String>,
    pub loaned_to: String,
    pub loan_started_at: chrono::DateTime<chrono::Utc>,
    pub loan_due_at: Option<chrono::DateTime<chrono::Utc>>,
}
