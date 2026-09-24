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

/// 冷 · How a private image leaves this server.
///
/// `private, no-cache` and a weak validator over the bytes: the browser
/// may keep the image, but must ask before every use — with the session
/// it has *now*. The previous `private, max-age=5 days` was a promise
/// the image stayed valid for five days whoever was signed in, and the
/// browser kept it: a custom poster lives at
/// `/api/user/storage/poster/{mal_id}`, the same URL for every account,
/// so the next person to sign in on a shared browser was shown the last
/// one's cover; and a snapshot stayed readable at its URL after logout,
/// with no session at all. `private` only ever kept shared caches out.
///
/// The validator makes asking cheap: an unchanged image answers `304`
/// with no body, and a different account's poster hashes differently
/// and comes back in full.
pub fn private_image_response(
    request_headers: &axum::http::HeaderMap,
    data: bytes::Bytes,
    disposition: Option<axum::http::HeaderValue>,
) -> axum::response::Response {
    use axum::http::{HeaderValue, StatusCode, header};
    use axum::response::IntoResponse;
    use sha2::{Digest, Sha256};

    let digest = Sha256::digest(&data);
    let hex: String = digest[..16].iter().map(|b| format!("{b:02x}")).collect();
    let etag = format!("W/\"{hex}\"");
    let cache = HeaderValue::from_static("private, no-cache");
    let etag_value =
        HeaderValue::from_str(&etag).unwrap_or_else(|_| HeaderValue::from_static("W/\"0\""));

    let matches = request_headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|offered| {
            offered.split(',').map(str::trim).any(|candidate| {
                candidate == "*"
                    || candidate.trim_start_matches("W/") == etag.trim_start_matches("W/")
            })
        });
    if matches {
        return (
            StatusCode::NOT_MODIFIED,
            [(header::ETAG, etag_value), (header::CACHE_CONTROL, cache)],
        )
            .into_response();
    }

    let content_type = detect(&data)
        .map(ImageFormat::content_type)
        .unwrap_or("image/jpeg");
    let mut response = (
        [
            (header::CONTENT_TYPE, HeaderValue::from_static(content_type)),
            (header::ETAG, etag_value),
            (header::CACHE_CONTROL, cache),
        ],
        axum::body::Body::from(data),
    )
        .into_response();
    if let Some(disposition) = disposition {
        response
            .headers_mut()
            .insert(header::CONTENT_DISPOSITION, disposition);
    }
    response
}

#[cfg(test)]
mod private_image_tests {
    use super::private_image_response;
    use axum::http::{HeaderMap, HeaderValue, StatusCode, header};

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

    #[test]
    fn a_private_image_must_be_asked_for_again() {
        let res = private_image_response(&HeaderMap::new(), bytes::Bytes::from_static(PNG), None);
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers()[header::CACHE_CONTROL], "private, no-cache");
        assert_eq!(res.headers()[header::CONTENT_TYPE], "image/png");
        assert!(
            res.headers()[header::ETAG]
                .to_str()
                .unwrap()
                .starts_with("W/\"")
        );
    }

    #[test]
    fn the_same_bytes_revalidate_and_different_bytes_do_not() {
        let first = private_image_response(&HeaderMap::new(), bytes::Bytes::from_static(PNG), None);
        let tag = first.headers()[header::ETAG].clone();
        let mut asking = HeaderMap::new();
        asking.insert(header::IF_NONE_MATCH, tag.clone());
        let again = private_image_response(&asking, bytes::Bytes::from_static(PNG), None);
        assert_eq!(again.status(), StatusCode::NOT_MODIFIED);
        // Another account's poster at the same URL hashes differently.
        let other = private_image_response(
            &asking,
            bytes::Bytes::from_static(b"\x89PNG\r\n\x1a\nother"),
            None,
        );
        assert_eq!(other.status(), StatusCode::OK);
        // A strong form of the same tag matches too.
        let mut strong = HeaderMap::new();
        let bare = tag.to_str().unwrap().trim_start_matches("W/").to_string();
        strong.insert(header::IF_NONE_MATCH, HeaderValue::from_str(&bare).unwrap());
        assert_eq!(
            private_image_response(&strong, bytes::Bytes::from_static(PNG), None).status(),
            StatusCode::NOT_MODIFIED
        );
    }
}
