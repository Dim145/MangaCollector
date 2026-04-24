use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "users")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub created_on: chrono::DateTime<chrono::Utc>,
    pub modified_on: chrono::DateTime<chrono::Utc>,
    pub name: Option<String>,
    pub email: Option<String>,
    pub google_id: Option<String>,
    /// Human-readable handle for the public read-only profile at
    /// `/u/{slug}`. NULL = private profile. Normalised to lowercase,
    /// 3..32 chars, `[a-z0-9-]`, cannot start or end with `-`.
    #[sea_orm(default)]
    pub public_slug: Option<String>,
    /// Owner opt-in: when TRUE, anonymous visitors of `/u/{slug}` see
    /// adult-tagged series. Independent of the owner's private adult
    /// filter. Default FALSE so enabling the public profile alone
    /// never exposes adult content by accident.
    #[sea_orm(default)]
    pub public_show_adult: bool,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

pub type User = Model;

/// DTO returned by `GET /auth/user`. Explicitly listed fields only —
/// the full `Model` would leak:
///   • `google_id` / OIDC subject (unique per-provider identifier for
///     cross-service correlation attacks)
///   • `email` (useful for phishing if ever exfiltrated via XSS)
///   • `created_on` / `modified_on` (low value, noisy)
///
/// Anything the SPA genuinely needs in the session context goes here;
/// if a new field is needed later, add it deliberately rather than
/// serialising the raw `User` model.
#[derive(Debug, Serialize)]
pub struct AuthUserResponse {
    pub id: i32,
    pub name: Option<String>,
    pub public_slug: Option<String>,
    pub public_show_adult: bool,
}

impl From<&Model> for AuthUserResponse {
    fn from(u: &Model) -> Self {
        Self {
            id: u.id,
            name: u.name.clone(),
            public_slug: u.public_slug.clone(),
            public_show_adult: u.public_show_adult,
        }
    }
}

/// Request body for PATCH /api/user/public-slug. Send `slug: null` (or
/// omit it) to disable the public profile. Empty string is also treated
/// as a disable signal for ergonomic reasons.
#[derive(Debug, Deserialize)]
pub struct UpdatePublicSlugRequest {
    pub slug: Option<String>,
}

/// Request body for PATCH /api/user/public-adult. Simple boolean — kept
/// as its own endpoint to sidestep the "null vs absent" ambiguity that
/// would appear if we fused it with the slug update.
#[derive(Debug, Deserialize)]
pub struct UpdatePublicAdultRequest {
    pub show_adult: bool,
}

/// API response for the private "my public profile state" endpoint.
/// Returns both fields so the Settings UI can hydrate its two toggles
/// from a single GET.
#[derive(Debug, Serialize)]
pub struct PublicSlugResponse {
    pub slug: Option<String>,
    pub show_adult: bool,
}

/// Shape returned by the public profile endpoint GET /public/u/{slug}.
///
/// Strictly read-only; exposes display name, aggregate stats, and the
/// library as a gallery. Deliberately NOT exposed: email, google_id,
/// per-volume prices, store locations, purchase dates, read dates (the
/// *fact* of having read is public via the series-level percent; the
/// *when* stays private).
#[derive(Debug, Serialize)]
pub struct PublicProfileResponse {
    pub slug: String,
    pub display_name: String,
    /// 2-char hanko initials derived server-side from display_name.
    pub hanko: String,
    /// Month/year the archive was started — formatted server-side to a
    /// locale-free ISO `YYYY-MM` string so the client can i18n-format it.
    pub since: String,
    pub stats: PublicProfileStats,
    pub library: Vec<PublicLibraryEntry>,
    /// True iff at least one entry in `library` is flagged `is_adult`.
    /// The client uses this to decide whether to render the warning
    /// banner + blur-by-default cards for anonymous visitors.
    pub has_adult_content: bool,
}

#[derive(Debug, Serialize)]
pub struct PublicProfileStats {
    pub series_count: i64,
    pub volumes_owned: i64,
    pub volumes_read: i64,
    pub fully_read_series: i64,
}

#[derive(Debug, Serialize)]
pub struct PublicLibraryEntry {
    pub mal_id: Option<i32>,
    pub name: String,
    pub image_url_jpg: Option<String>,
    pub volumes: i32,
    pub volumes_owned: i32,
    pub genres: Vec<String>,
    /// True if every published volume is read (matches the fully-read seal).
    pub fully_read: bool,
    /// True if every owned volume is collector.
    pub all_collector: bool,
    /// Percentage of volumes read (0..100) — rounded server-side.
    pub read_percent: i32,
    /// True if any of the entry's genres matches the public-adult list.
    /// Only ever set to `true` when the owner has opted-in via
    /// `public_show_adult` — if the flag is off, adult entries are
    /// filtered out server-side and never reach this DTO.
    pub is_adult: bool,
}
