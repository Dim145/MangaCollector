//! Single source of truth for "is this manga adult-tagged?".
//!
//! The list of genre names that trigger adult-content gating is
//! kept in sync with the frontend (`client/src/utils/library.js`).
//! Centralised here so every server-side caller — public profile
//! filtering, MangaDex cover upgrade, /compare bundle generation —
//! agrees on the rule. Three near-identical copies used to live in
//! `services/{users,library,compare}.rs` and they had already
//! drifted slightly; this consolidation removes that drift.

/// Genre names (case-insensitive) considered adult content.
pub const ADULT_GENRES: &[&str] = &["hentai", "erotica", "adult"];

/// True iff any genre in `genres` matches an entry in `ADULT_GENRES`,
/// case-insensitive.
pub fn is_adult(genres: &[String]) -> bool {
    genres.iter().any(|g| {
        let lower = g.to_lowercase();
        ADULT_GENRES.iter().any(|bad| *bad == lower)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_lowercase() {
        assert!(is_adult(&["hentai".into()]));
    }

    #[test]
    fn matches_mixed_case() {
        assert!(is_adult(&["Erotica".into(), "Other".into()]));
    }

    #[test]
    fn rejects_safe_only() {
        assert!(!is_adult(&["Action".into(), "Drama".into()]));
    }

    #[test]
    fn empty_is_safe() {
        let empty: Vec<String> = Vec::new();
        assert!(!is_adult(&empty));
    }
}
