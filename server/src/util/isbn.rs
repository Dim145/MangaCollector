//! 番 · ISBN normalisation shared by the volume PATCH, the resolver and
//! the archive importer.
//!
//! Everything is stored and compared in the 13-digit form: that is what
//! an EAN-13 barcode scan yields, and an ISBN-10 converts to it without
//! loss (prefix 978, recomputed check digit).

/// Strip separators, validate the checksum (ISBN-10 or ISBN-13) and
/// return the canonical 13-digit string. `None` for anything else.
pub fn normalize_isbn13(raw: &str) -> Option<String> {
    let clean: String = raw
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect::<String>()
        .to_ascii_uppercase();
    let bytes = clean.as_bytes();
    match bytes.len() {
        13 if bytes.iter().all(u8::is_ascii_digit) && valid13(bytes) => Some(clean),
        10 if bytes[..9].iter().all(u8::is_ascii_digit)
            && (bytes[9].is_ascii_digit() || bytes[9] == b'X')
            && valid10(bytes) =>
        {
            Some(to13(&clean[..9]))
        }
        _ => None,
    }
}

fn valid10(b: &[u8]) -> bool {
    let mut sum: u32 = 0;
    for (i, d) in b[..9].iter().enumerate() {
        sum += (10 - i as u32) * u32::from(d - b'0');
    }
    sum += if b[9] == b'X' {
        10
    } else {
        u32::from(b[9] - b'0')
    };
    sum.is_multiple_of(11)
}

fn check13(first12: &[u8]) -> u8 {
    let sum: u32 = first12
        .iter()
        .enumerate()
        .map(|(i, d)| u32::from(d - b'0') * if i % 2 == 0 { 1 } else { 3 })
        .sum();
    ((10 - (sum % 10)) % 10) as u8
}

fn valid13(b: &[u8]) -> bool {
    check13(&b[..12]) == b[12] - b'0'
}

fn to13(first9: &str) -> String {
    let base = format!("978{first9}");
    let check = check13(base.as_bytes());
    format!("{base}{check}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_isbn13_with_or_without_separators() {
        assert_eq!(
            normalize_isbn13("9780306406157").as_deref(),
            Some("9780306406157")
        );
        assert_eq!(
            normalize_isbn13("978-0-306-40615-7").as_deref(),
            Some("9780306406157")
        );
        assert_eq!(
            normalize_isbn13(" 978 0306 406157 ").as_deref(),
            Some("9780306406157")
        );
    }

    #[test]
    fn converts_isbn10_to_13() {
        assert_eq!(
            normalize_isbn13("0306406152").as_deref(),
            Some("9780306406157")
        );
        assert_eq!(
            normalize_isbn13("0-8044-2957-X").as_deref(),
            Some("9780804429573")
        );
        assert_eq!(
            normalize_isbn13("080442957x").as_deref(),
            Some("9780804429573")
        );
    }

    #[test]
    fn rejects_bad_checksums_and_junk() {
        assert_eq!(normalize_isbn13("9780306406158"), None);
        assert_eq!(normalize_isbn13("0306406153"), None);
        assert_eq!(normalize_isbn13("978030640615"), None);
        assert_eq!(normalize_isbn13("not an isbn"), None);
        assert_eq!(normalize_isbn13(""), None);
    }
}
