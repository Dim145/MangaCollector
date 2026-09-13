use axum::{
    Json,
    extract::{Path, State},
};

use crate::auth::AuthenticatedUser;
use crate::errors::AppError;
use crate::services::isbn_resolver::{self, ResolveOutcome};
use crate::state::AppState;

/// GET /api/user/isbn/{isbn} — resolve a scanned barcode to book metadata
/// through the server-side catalogue chain (see `services::isbn_resolver`).
/// Authenticated so the instance's shared cache cannot be filled by
/// anonymous traffic; a malformed ISBN is a 400, an unknown one a 200
/// with `found: false`.
pub async fn lookup(
    State(state): State<AppState>,
    AuthenticatedUser(_user): AuthenticatedUser,
    Path(raw): Path<String>,
) -> Result<Json<ResolveOutcome>, AppError> {
    let isbn = crate::util::isbn::normalize_isbn13(&raw)
        .ok_or_else(|| AppError::BadRequest("Not a valid ISBN-10 or ISBN-13.".into()))?;
    let outcome = isbn_resolver::resolve(&state, &isbn).await?;
    Ok(Json(outcome))
}
