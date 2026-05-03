//! Canonical-form UUID validation, case-insensitive.
//!
//! Centralised so every caller (`add_from_mangadex` handler, the
//! AniList/Jikan import service) shares one definition. The previous
//! `looks_like_uuid` / `is_uuid` pair drifted on case-handling
//! (one accepted lowercase only, the other both) — the policy is
//! now a single function with a single rule.

/// True iff `s` is the 36-char canonical UUID form
/// `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (case-insensitive hex).
pub fn is_canonical_uuid(s: &str) -> bool {
    if s.len() != 36 {
        return false;
    }
    let bytes = s.as_bytes();
    for (i, b) in bytes.iter().enumerate() {
        let dash = matches!(i, 8 | 13 | 18 | 23);
        if dash {
            if *b != b'-' {
                return false;
            }
        } else if !b.is_ascii_hexdigit() {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_canonical_lowercase() {
        assert!(is_canonical_uuid("a1b2c3d4-e5f6-7890-abcd-ef0123456789"));
    }

    #[test]
    fn accepts_canonical_uppercase() {
        assert!(is_canonical_uuid("A1B2C3D4-E5F6-7890-ABCD-EF0123456789"));
    }

    #[test]
    fn rejects_wrong_length() {
        assert!(!is_canonical_uuid("a1b2c3d4-e5f6-7890-abcd-ef012345678"));
        assert!(!is_canonical_uuid("a1b2c3d4-e5f6-7890-abcd-ef01234567890"));
        assert!(!is_canonical_uuid(""));
    }

    #[test]
    fn rejects_misplaced_dashes() {
        assert!(!is_canonical_uuid("a1b2c3d4ee5f6-7890-abcd-ef0123456789"));
    }

    #[test]
    fn rejects_non_hex() {
        assert!(!is_canonical_uuid("g1b2c3d4-e5f6-7890-abcd-ef0123456789"));
    }
}
