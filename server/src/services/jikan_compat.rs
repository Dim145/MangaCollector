//! 互 · Jikan answers from a mirror that is not schema-identical.
//!
//! `JIKAN_API_URL` may name the public Jikan v4 or a gateway that serves
//! the same routes with different JSON. The one in use when this was
//! written, jikan-edge (`https://jikan.lucashdo.com/v1`), keeps Jikan's
//! paths but answers in camelCase, flattens objects (`imageUrl` where
//! Jikan nests `images.jpg.image_url`; `titleEnglish` where Jikan lists
//! `titles`), wraps everything in `{ data, meta }` with the pagination
//! in `meta`, drops the `type` Jikan puts on each genre, and writes a
//! person's name family-first and a birthday as `Jan 1, 1975`.
//!
//! Each function here takes one item as a mirror sent it and returns it
//! as Jikan v4 would have, so every parser downstream stays written
//! against one schema. Detection is per item, by key: an item already
//! in Jikan's shape (it has `mal_id`) comes back untouched, so the same
//! code reads both and nothing has to be told which one it is talking
//! to.
//!
//! What a mirror does not carry is left out rather than guessed. The
//! one loss that matters: jikan-edge's user lists count **chapters**
//! (`progress` / `total`), not volumes, so an import by username through
//! it knows what is on the list and in what state, but not how many
//! tomes were read — `MAL_CLIENT_ID` answers that.

use serde_json::{Map, Value, json};

/// Whether an object is in the camelCase dialect.
fn is_camel(v: &Value) -> bool {
    v.get("malId").is_some() && v.get("mal_id").is_none()
}

fn text(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
}

/// `{ malId, name, url }` → Jikan's `{ mal_id, type, name, url }`.
fn named(list: Option<&Value>, kind: &str) -> Value {
    let items = list
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|g| {
                    Some(json!({
                        "mal_id": g.get("malId").cloned().unwrap_or(Value::Null),
                        "type": kind,
                        "name": text(g, "name")?,
                        "url": g.get("url").cloned().unwrap_or(Value::Null),
                    }))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Value::Array(items)
}

/// MAL's own large rendition of a cover: `…/253146.jpg` → `…/253146l.jpg`.
/// Only for the plain `images/{kind}/{shard}/{id}.{ext}` shape — anything
/// else is not guessed at.
fn large_variant(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://cdn.myanimelist.net/images/")?;
    let (stem, ext) = rest.rsplit_once('.')?;
    let file = stem.rsplit('/').next()?;
    let plain = !file.is_empty() && file.bytes().all(|b| b.is_ascii_digit());
    (plain && matches!(ext, "jpg" | "webp"))
        .then(|| format!("https://cdn.myanimelist.net/images/{stem}l.{ext}"))
}

/// A list thumbnail — `https://cdn.myanimelist.net/r/192x272/images/…?s=…`
/// — as the plain image it was resized from, which the cover allow-list
/// and the relay both know.
fn canonical_cover(url: &str) -> String {
    let Some(rest) = url.strip_prefix("https://cdn.myanimelist.net/r/") else {
        return url.to_string();
    };
    match rest.split_once('/') {
        Some((size, path)) if size.split('x').all(|n| n.parse::<u32>().is_ok()) => {
            let path = path.split('?').next().unwrap_or(path);
            format!("https://cdn.myanimelist.net/{path}")
        }
        _ => url.to_string(),
    }
}

/// Jikan's `images` object from the dialect's `images` / `imageUrl`.
fn images(v: &Value) -> Value {
    let flat = text(v, "imageUrl").map(|u| canonical_cover(&u));
    let nested = v.get("images");
    let pick = |key: &str| nested.and_then(|i| text(i, key));
    let medium = pick("medium").or_else(|| flat.clone());
    let large = pick("large")
        .or_else(|| medium.as_deref().and_then(large_variant))
        .or_else(|| medium.clone());
    json!({
        "jpg": {
            "image_url": medium,
            "small_image_url": pick("small"),
            "large_image_url": large,
        }
    })
}

/// A manga — a detail page or a search result.
pub fn manga(v: Value) -> Value {
    if !is_camel(&v) {
        return v;
    }
    let mut titles = Vec::new();
    if let Some(t) = text(&v, "title") {
        titles.push(json!({ "type": "Default", "title": t }));
    }
    if let Some(list) = v.get("titleSynonyms").and_then(Value::as_array) {
        for t in list.iter().filter_map(Value::as_str).map(str::trim) {
            if !t.is_empty() {
                titles.push(json!({ "type": "Synonym", "title": t }));
            }
        }
    }
    if let Some(t) = text(&v, "titleJapanese") {
        titles.push(json!({ "type": "Japanese", "title": t }));
    }
    if let Some(t) = text(&v, "titleEnglish") {
        titles.push(json!({ "type": "English", "title": t }));
    }
    let mut out = Map::new();
    out.insert("mal_id".into(), v["malId"].clone());
    out.insert(
        "title".into(),
        text(&v, "title").map(Value::String).unwrap_or(Value::Null),
    );
    out.insert("titles".into(), Value::Array(titles));
    out.insert("images".into(), images(&v));
    out.insert(
        "volumes".into(),
        v.get("volumes").cloned().unwrap_or(Value::Null),
    );
    out.insert(
        "score".into(),
        v.get("score").cloned().unwrap_or(Value::Null),
    );
    out.insert("genres".into(), named(v.get("genres"), "manga"));
    out.insert(
        "explicit_genres".into(),
        named(v.get("explicitGenres"), "manga"),
    );
    out.insert("themes".into(), named(v.get("themes"), "manga"));
    out.insert("demographics".into(), named(v.get("demographics"), "manga"));
    out.insert("authors".into(), named(v.get("authors"), "people"));
    Value::Object(out)
}

/// An alternate cover: `{ imageUrl, thumbnailUrl }` (the large file and
/// the regular one).
pub fn picture(v: Value) -> Value {
    if v.get("jpg").is_some() || v.get("imageUrl").is_none() {
        return v;
    }
    json!({
        "jpg": {
            "image_url": text(&v, "thumbnailUrl").or_else(|| text(&v, "imageUrl")),
            "large_image_url": text(&v, "imageUrl"),
        }
    })
}

/// A readers' recommendation: flat `{ malId, title, imageUrl, votes }`.
pub fn recommendation(v: Value) -> Value {
    if !is_camel(&v) || v.get("entry").is_some() {
        return v;
    }
    json!({
        "entry": {
            "mal_id": v["malId"].clone(),
            "title": text(&v, "title"),
            "images": { "jpg": { "image_url": text(&v, "imageUrl") } },
        },
        "votes": v.get("votes").cloned().unwrap_or(Value::Null),
    })
}

/// A character of a manga: flat `{ malId, name, imageUrl, role }`.
pub fn character(v: Value) -> Value {
    if !is_camel(&v) || v.get("character").is_some() {
        return v;
    }
    json!({
        "character": {
            "mal_id": v["malId"].clone(),
            "name": text(&v, "name"),
            "images": { "jpg": { "image_url": text(&v, "imageUrl") } },
        },
        "role": text(&v, "role"),
    })
}

/// "Oda, Eiichiro" → "Eiichiro Oda" — Jikan's person `name` is
/// given-first (the family-first form is what it uses in a manga's
/// `authors`).
fn given_first(name: &str) -> String {
    match name.split_once(',') {
        Some((family, given)) if !family.trim().is_empty() && !given.trim().is_empty() => {
            format!("{} {}", given.trim(), family.trim())
        }
        _ => name.trim().to_string(),
    }
}

/// "Jan 1, 1975" → "1975-01-01". A birthday without a year is not one
/// a date can carry, and is dropped.
fn iso_day(raw: &str) -> Option<String> {
    let raw = raw.trim();
    ["%b %d, %Y", "%B %d, %Y"]
        .iter()
        .find_map(|f| chrono::NaiveDate::parse_from_str(raw, f).ok())
        .map(|d| d.format("%Y-%m-%d").to_string())
}

/// A person (an author's page).
pub fn person(v: Value) -> Value {
    if !is_camel(&v) {
        return v;
    }
    let image = v
        .get("images")
        .and_then(|i| text(i, "medium").or_else(|| text(i, "large")))
        .or_else(|| text(&v, "imageUrl"));
    json!({
        "mal_id": v["malId"].clone(),
        "url": text(&v, "url"),
        "images": { "jpg": { "image_url": image } },
        "name": text(&v, "name").map(|n| given_first(&n)).unwrap_or_default(),
        "given_name": text(&v, "givenName"),
        "family_name": text(&v, "familyName"),
        "birthday": text(&v, "birthday").and_then(|b| iso_day(&b).or(Some(b))),
        "favorites": v.get("favorites").cloned().unwrap_or(Value::Null),
        "about": text(&v, "about"),
    })
}

/// An entry of a user's public list. `progress` / `total` are chapters
/// on jikan-edge, so the volumes stay unknown (`null`) rather than be
/// filled with a chapter count.
pub fn list_entry(v: Value) -> Value {
    if !is_camel(&v) || v.get("manga").is_some() {
        return v;
    }
    json!({
        "manga": {
            "mal_id": v["malId"].clone(),
            "title": text(&v, "title").unwrap_or_default(),
            "images": { "jpg": { "image_url": text(&v, "imageUrl").map(|u| canonical_cover(&u)) } },
            "volumes": Value::Null,
        },
        "read_volumes": Value::Null,
        "reading_status": text(&v, "status"),
        "start_date": text(&v, "startedAt"),
        "end_date": text(&v, "finishedAt"),
    })
}

/// Whether a paginated answer has another page: Jikan's
/// `pagination.has_next_page`, or `meta.pagination.hasNextPage`.
pub fn has_next_page(body: &Value) -> bool {
    body.pointer("/pagination/has_next_page")
        .or_else(|| body.pointer("/meta/pagination/hasNextPage"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// The `data` array of an answer, each item passed through `normalise`.
pub fn data_list(body: &Value, normalise: fn(Value) -> Value) -> Vec<Value> {
    body.get("data")
        .and_then(Value::as_array)
        .map(|items| items.iter().cloned().map(normalise).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// jikan-edge's `/v1/manga/13/full`, trimmed to what is read.
    fn edge_one_piece() -> Value {
        json!({
            "malId": 13,
            "url": "https://myanimelist.net/manga/13/One_Piece",
            "title": "One Piece",
            "titleEnglish": "One Piece",
            "titleJapanese": "ONE PIECE",
            "titleSynonyms": [],
            "imageUrl": "https://cdn.myanimelist.net/images/manga/2/253146.jpg",
            "images": {
                "small": "https://cdn.myanimelist.net/images/manga/2/253146t.jpg",
                "medium": "https://cdn.myanimelist.net/images/manga/2/253146.jpg",
                "large": "https://cdn.myanimelist.net/images/manga/2/253146l.jpg"
            },
            "type": "Manga",
            "volumes": null,
            "authors": [{"malId": 1881, "name": "Oda, Eiichiro", "url": "https://myanimelist.net/people/1881/Eiichiro_Oda"}],
            "genres": [
                {"malId": 1, "name": "Action", "url": "https://myanimelist.net/manga/genre/1/Action"},
                {"malId": 2, "name": "Adventure", "url": "https://myanimelist.net/manga/genre/2/Adventure"}
            ],
            "themes": [],
            "demographics": [{"malId": 27, "name": "Shounen", "url": "https://myanimelist.net/manga/genre/27/Shounen"}],
            "score": 9.21
        })
    }

    #[test]
    fn a_camel_case_manga_reads_as_jikan_v4() {
        let data: crate::services::mal_api::MalMangaData =
            serde_json::from_value(manga(edge_one_piece())).expect("Jikan v4 shape");
        assert_eq!(data.mal_id, 13);
        assert_eq!(data.title.as_deref(), Some("One Piece"));
        assert_eq!(data.volumes, None);
        let jpg = data.images.as_ref().and_then(|i| i.jpg.as_ref()).unwrap();
        assert_eq!(
            jpg.large_image_url.as_deref(),
            Some("https://cdn.myanimelist.net/images/manga/2/253146l.jpg")
        );
        // Jikan types every genre, and the library keeps only `manga`.
        let genres: Vec<_> = data
            .genres
            .iter()
            .flatten()
            .map(|g| (g.genre_type.as_str(), g.name.as_str()))
            .collect();
        assert_eq!(genres, [("manga", "Action"), ("manga", "Adventure")]);
        assert_eq!(data.demographics.as_ref().unwrap()[0].name, "Shounen");
        let author = data.primary_author().unwrap();
        assert_eq!(
            (author.mal_id, author.name.as_str()),
            (Some(1881), "Oda, Eiichiro")
        );
        let titles: Vec<_> = data
            .titles
            .iter()
            .flatten()
            .map(|t| (t.title_type.clone(), t.title.clone()))
            .collect();
        assert!(titles.contains(&("English".into(), "One Piece".into())));
        assert!(titles.contains(&("Japanese".into(), "ONE PIECE".into())));
    }

    #[test]
    fn a_jikan_v4_item_is_left_alone() {
        let v4 = json!({"mal_id": 13, "title": "One Piece", "images": {"jpg": {"image_url": "x"}}});
        assert_eq!(manga(v4.clone()), v4);
        assert_eq!(recommendation(v4.clone()), v4);
        assert_eq!(character(v4.clone()), v4);
        assert_eq!(person(v4.clone()), v4);
        assert_eq!(list_entry(v4.clone()), v4);
    }

    #[test]
    fn a_search_result_gains_the_large_cover() {
        // `/v1/manga?q=` items carry one image, the regular rendition.
        let item = json!({"malId": 13, "title": "One Piece", "imageUrl": "https://cdn.myanimelist.net/images/manga/2/253146.jpg", "type": "Manga", "score": 9.21, "volumes": null});
        let v = manga(item);
        assert_eq!(
            v.pointer("/images/jpg/large_image_url")
                .and_then(Value::as_str),
            Some("https://cdn.myanimelist.net/images/manga/2/253146l.jpg")
        );
        assert_eq!(v["score"], json!(9.21));
        // Nothing to guess from an address that is not MAL's plain shape.
        assert_eq!(large_variant("https://example.org/a.jpg"), None);
        assert_eq!(
            large_variant("https://cdn.myanimelist.net/images/manga/2/253146l.jpg"),
            None
        );
    }

    #[test]
    fn pictures_recommendations_and_characters_unflatten() {
        let pic = picture(
            json!({"imageUrl": "https://cdn.myanimelist.net/images/manga/3/55539l.jpg", "thumbnailUrl": "https://cdn.myanimelist.net/images/manga/3/55539.jpg"}),
        );
        assert_eq!(
            pic.pointer("/jpg/large_image_url").and_then(Value::as_str),
            Some("https://cdn.myanimelist.net/images/manga/3/55539l.jpg")
        );
        let rec = recommendation(
            json!({"malId": 598, "title": "Fairy Tail", "imageUrl": "https://cdn.myanimelist.net/images/manga/3/198604.jpg", "votes": 26}),
        );
        assert_eq!(rec.pointer("/entry/mal_id"), Some(&json!(598)));
        assert_eq!(rec["votes"], json!(26));
        let ch = character(
            json!({"malId": 5627, "name": "Brook", "imageUrl": "https://cdn.myanimelist.net/images/characters/10/161005.jpg", "role": "Main", "favorites": 11266}),
        );
        assert_eq!(
            ch.pointer("/character/name").and_then(Value::as_str),
            Some("Brook")
        );
        assert_eq!(ch["role"], json!("Main"));
    }

    #[test]
    fn a_person_is_given_first_with_an_iso_birthday() {
        let p = person(json!({
            "malId": 1881, "url": "https://myanimelist.net/people/1881/Eiichiro_Oda",
            "name": "Oda, Eiichiro", "givenName": "栄一郎", "familyName": "尾田",
            "birthday": "Jan 1, 1975",
            "images": {"small": null, "medium": "https://cdn.myanimelist.net/images/voiceactors/2/74096.jpg"},
            "about": "Hometown: Kumamoto", "favorites": 56915
        }));
        assert_eq!(p["name"], json!("Eiichiro Oda"));
        assert_eq!(p["birthday"], json!("1975-01-01"));
        assert_eq!(
            p.pointer("/images/jpg/image_url").and_then(Value::as_str),
            Some("https://cdn.myanimelist.net/images/voiceactors/2/74096.jpg")
        );
        // A one-word name stays as it is.
        assert_eq!(given_first("CLAMP"), "CLAMP");
    }

    #[test]
    fn a_list_entry_keeps_its_state_and_not_a_chapter_count() {
        let e = list_entry(json!({
            "malId": 68, "title": "3.3.7 Byooshi!!",
            "imageUrl": "https://cdn.myanimelist.net/r/192x272/images/manga/1/267905.jpg?s=95f1927118cbeab7711e17b4dd256ba8",
            "status": "on hold", "progress": 14, "total": 86,
            "startedAt": "2007-08-07", "finishedAt": null
        }));
        assert_eq!(e.pointer("/manga/mal_id"), Some(&json!(68)));
        assert_eq!(e["reading_status"], json!("on hold"));
        assert_eq!(e["start_date"], json!("2007-08-07"));
        // 14 and 86 are chapters: not tomes, so not volumes.
        assert_eq!(e["read_volumes"], Value::Null);
        assert_eq!(e.pointer("/manga/volumes"), Some(&Value::Null));
        // The resized thumbnail becomes the image it came from.
        assert_eq!(
            e.pointer("/manga/images/jpg/image_url")
                .and_then(Value::as_str),
            Some("https://cdn.myanimelist.net/images/manga/1/267905.jpg")
        );
    }

    #[test]
    fn both_paginations_are_read() {
        assert!(has_next_page(
            &json!({"pagination": {"has_next_page": true}})
        ));
        assert!(has_next_page(
            &json!({"meta": {"pagination": {"hasNextPage": true}}})
        ));
        assert!(!has_next_page(
            &json!({"meta": {"pagination": {"hasNextPage": false}}})
        ));
        assert!(!has_next_page(&json!({"data": []})));
    }
}
