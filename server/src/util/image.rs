//! Magic-byte detection for the three image formats this server
//! accepts on upload and serves back to the SPA.
//!
//! Centralised here so every handler shares one validation policy
//! and one format → Content-Type mapping. The previous code lived
//! in three slightly-different copies across `handlers/{storage,
//! snapshot, author}.rs`, each pinning the served Content-Type to
//! a single value (`image/jpeg` or `image/png`) regardless of the
//! actual blob bytes — the resulting mismatch combined with the
//! `nosniff` header sometimes broke rendering, and removed any
//! defence-in-depth value from the magic-byte check.

/// One of the three image formats the upload pipeline accepts.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ImageFormat {
    Png,
    Jpeg,
    Webp,
}

impl ImageFormat {
    /// MIME type for `Content-Type` headers when serving a stored
    /// blob back to the browser.
    pub fn content_type(self) -> &'static str {
        match self {
            ImageFormat::Png => "image/png",
            ImageFormat::Jpeg => "image/jpeg",
            ImageFormat::Webp => "image/webp",
        }
    }

    /// True when this format is in the caller's whitelist.
    pub fn is_in(self, allowed: &[ImageFormat]) -> bool {
        allowed.contains(&self)
    }
}

/// PNG: fixed 8-byte signature.
const PNG_SIG: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

/// Detect the format of a blob from its magic bytes. Returns `None`
/// when the bytes don't match any supported format. Cheap — touches
/// at most the first 12 bytes.
pub fn detect(bytes: &[u8]) -> Option<ImageFormat> {
    if bytes.len() >= 8 && bytes[..8] == PNG_SIG {
        return Some(ImageFormat::Png);
    }
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return Some(ImageFormat::Jpeg);
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some(ImageFormat::Webp);
    }
    None
}

/// Convenience for upload handlers — true iff the blob is one of the
/// allowed formats.
pub fn is_supported(bytes: &[u8], allowed: &[ImageFormat]) -> bool {
    detect(bytes).map(|f| f.is_in(allowed)).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_png() {
        let mut bytes = PNG_SIG.to_vec();
        bytes.extend_from_slice(b"...payload");
        assert_eq!(detect(&bytes), Some(ImageFormat::Png));
    }

    #[test]
    fn detects_jpeg() {
        let bytes = vec![0xFF, 0xD8, 0xFF, 0xE0, b'J', b'F', b'I', b'F'];
        assert_eq!(detect(&bytes), Some(ImageFormat::Jpeg));
    }

    #[test]
    fn detects_webp() {
        let mut bytes = b"RIFF".to_vec();
        bytes.extend_from_slice(&[0u8; 4]);
        bytes.extend_from_slice(b"WEBP");
        assert_eq!(detect(&bytes), Some(ImageFormat::Webp));
    }

    #[test]
    fn rejects_unknown() {
        assert_eq!(detect(b"<html></html>"), None);
        assert_eq!(detect(&[0u8; 4]), None);
        assert_eq!(detect(&[]), None);
    }

    #[test]
    fn whitelist_filters_format() {
        let mut png = PNG_SIG.to_vec();
        png.push(0);
        assert!(is_supported(&png, &[ImageFormat::Png]));
        assert!(!is_supported(&png, &[ImageFormat::Jpeg]));
    }
}
