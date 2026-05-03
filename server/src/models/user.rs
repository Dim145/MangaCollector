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
    /// 祝 · Birthday-mode horizon. When `Some(t)` AND `t > now()`,
    /// the public profile additionally surfaces wishlist entries
    /// (`volumes_owned = 0`). Lapses automatically when the comparison
    /// goes false; the row stays in the DB until the next mutation —
    /// the application layer treats expired-or-NULL as "feature off".
    #[sea_orm(default)]
    pub wishlist_public_until: Option<chrono::DateTime<chrono::Utc>>,
    /// 暦 · Secret token for the subscribable ICS calendar feed. NULL
    /// means the user has never opted in (the SPA will mint a token
    /// the first time they open the "Subscribe" modal). UUID v4 by
    /// convention but the column is opaque text — anything random
    /// and unique works.
    ///
    /// Treated as a credential: anyone holding it can read the user's
    /// upcoming-volume timeline through the public ICS handler. The
    /// SPA exposes a "Regenerate" action that mints a new token + drops
    /// the old one, invalidating any leaked URL.
    #[sea_orm(default)]
    pub calendar_token: Option<String>,
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
    /// 祝 · Birthday-mode horizon — only emitted when *still active*
    /// (i.e. > now). The Settings panel uses this to decide whether
    /// the toggle should render the "active until …" / "expired" copy
    /// vs. the inert "activate" CTA.
    pub wishlist_public_until: Option<chrono::DateTime<chrono::Utc>>,
}

impl From<&Model> for AuthUserResponse {
    fn from(u: &Model) -> Self {
        // Strip an expired horizon so the SPA never thinks the feature
        // is on when it actually isn't. Keeps the client-side state
        // logic trivial: `Some(_)` ⇒ active.
        let wishlist_public_until = u
            .wishlist_public_until
            .filter(|t| *t > chrono::Utc::now());
        Self {
            id: u.id,
            name: u.name.clone(),
            public_slug: u.public_slug.clone(),
            public_show_adult: u.public_show_adult,
            wishlist_public_until,
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

/// Request body for `PATCH /api/user/wishlist-public`.
///
/// Activation is duration-based rather than open-ended: a single field
/// `days` lets the client pick the window (capped server-side). Sending
/// `0` or omitting both fields disables the feature outright.
///
/// Why not a hard date? Because the use case is "I want this open for
/// 30 days from now"; a date field would push timezone semantics onto
/// the client. The server stamps `now() + days` so there's a single
/// time source.
#[derive(Debug, Deserialize)]
pub struct UpdateWishlistPublicRequest {
    /// Number of days to keep the wishlist publicly visible. `0` (or
    /// omitted) disables the feature.
    #[serde(default)]
    pub days: i64,
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
    /// 祝 · When `Some(t)`, the owner has opened their wishlist for
    /// public viewing until `t`. The SPA renders a friendly banner and
    /// keeps `volumes_owned == 0` rows visible. Stripped to `None` once
    /// the timestamp lapses — visitors never see a stale "active until
    /// 1999" row.
    pub wishlist_open_until: Option<chrono::DateTime<chrono::Utc>>,
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
    /// 記憶 · The owner's personal review on this series. Only Some
    /// when `library.review_public = true` AND the row carries a
    /// non-empty review. Always None on private profiles or when the
    /// review_public flag is off — no leakage path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review: Option<String>,
}

/// Derive the 2-character "hanko" stamp label shown on a user's profile
/// (own dashboard) and on the comparison page (`/compare/:slug`).
///
/// Algorithm:
///   1. If `display_name` splits into ≥2 whitespace-separated words,
///      take the first **alphabetic** char of each of the first two
///      words and uppercase. Skips leading punctuation: `"(John) (Doe)"`
///      → `"JD"`. Returns immediately if both yield a letter.
///   2. Otherwise, take the first 2 **alphanumeric** chars of
///      `display_name` (so `"j_o"` → `"JO"`, not `"J_"`). Falls back
///      to `fallback` (typically the public slug) when `display_name`
///      is empty or holds no alphanumerics.
///
/// Always returns a 1-or-2 char uppercase string; never panics. Two
/// services used to carry near-identical copies — this is the
/// canonical version.
pub fn derive_hanko(display_name: &str, fallback: &str) -> String {
    let words: Vec<&str> = display_name.split_whitespace().collect();
    if words.len() >= 2 {
        let mut out = String::new();
        for w in words.iter().take(2) {
            if let Some(c) = w.chars().find(|c| c.is_alphabetic()) {
                out.push(c.to_ascii_uppercase());
            }
        }
        if out.chars().count() == 2 {
            return out;
        }
    }

    // 1-word fallback: alphanumerics-only of display_name (so symbols
    // like `_` / `(` get stripped before slicing); fall back to the
    // caller-supplied default when the name yields nothing.
    let cleaned: String = display_name
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect();
    let source = if cleaned.is_empty() {
        fallback
    } else {
        cleaned.as_str()
    };
    source
        .chars()
        .take(2)
        .collect::<String>()
        .to_uppercase()
}
