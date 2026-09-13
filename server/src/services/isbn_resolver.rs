//! 番 · ISBN → book metadata, server-side, with a chain of catalogues.
//!
//! The scanner used to ask Google Books straight from the browser: every
//! device paid its own calls against the per-IP anonymous quota, and an
//! edition Google does not know (frequent for French and Japanese
//! prints) was a dead end. The server now resolves once for everyone,
//! walks a chain of free catalogues until one answers, and keeps the
//! result in `isbn_cache` (30 days for a hit, 1 day for a miss):
//!
//! 1. Google Books — richest (description, price), needs a key for any
//!    real volume of calls
//! 2. Open Library — free, no key, decent EN/FR coverage, covers by id
//! 3. BnF (SRU) — the French national catalogue: every ISBN deposited in
//!    France, Dublin Core XML, no key
//! 4. openBD — the Japanese publishers' catalogue, JSON, no key
//!
//! Every source normalises to the same `IsbnBook`; the client keeps its
//! own local cache in front and can fall back to the CORS-friendly
//! sources itself when this server is unreachable.
use std::time::Duration;

use chrono::{DateTime, Utc};
use sea_orm::sea_query::OnConflict;
use sea_orm::{ActiveValue::Set, EntityTrait};
use serde::{Deserialize, Serialize};

use crate::errors::AppError;
use crate::models::isbn_cache::{self, Entity as CacheEntity};
use crate::state::AppState;

const SOURCE_TIMEOUT: Duration = Duration::from_secs(7);
const HIT_TTL: chrono::Duration = chrono::Duration::days(30);
const MISS_TTL: chrono::Duration = chrono::Duration::days(1);
const USER_AGENT: &str = concat!("MangaCollector/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IsbnPrice {
    pub amount: f64,
    pub currency: String,
}

/// One book as every catalogue describes it, once normalised.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IsbnBook {
    pub isbn: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    /// Publication date as the source gives it (year, or ISO date).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_count: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<IsbnPrice>,
    pub source: String,
}

/// What `GET /api/user/isbn/{isbn}` returns. `found: false` is a real
/// answer ("nobody knows this barcode"), distinct from a transport error.
#[derive(Debug, Clone, Serialize)]
pub struct ResolveOutcome {
    pub isbn: String,
    pub found: bool,
    pub book: Option<IsbnBook>,
    pub source: Option<String>,
    pub cached: bool,
}

/// One catalogue lookup, boxed so the chain can be walked in order.
type SourceFuture<'a> = std::pin::Pin<
    Box<dyn std::future::Future<Output = anyhow::Result<Option<IsbnBook>>> + Send + 'a>,
>;

/// Is a cache row still good on `now`? Hits live long, misses short.
pub fn cache_is_fresh(found: bool, fetched_at: DateTime<Utc>, now: DateTime<Utc>) -> bool {
    let ttl = if found { HIT_TTL } else { MISS_TTL };
    now.signed_duration_since(fetched_at) < ttl
}

/// Resolve a canonical ISBN-13 (see `util::isbn::normalize_isbn13`).
pub async fn resolve(state: &AppState, isbn: &str) -> Result<ResolveOutcome, AppError> {
    let now = Utc::now();
    if let Some(row) = CacheEntity::find_by_id(isbn.to_string())
        .one(&state.db)
        .await
        .map_err(AppError::from)?
        && cache_is_fresh(row.found, row.fetched_at, now)
    {
        let book = row
            .payload
            .as_deref()
            .and_then(|p| serde_json::from_str::<IsbnBook>(p).ok());
        return Ok(ResolveOutcome {
            isbn: isbn.to_string(),
            found: row.found && book.is_some(),
            source: row.source,
            book,
            cached: true,
        });
    }

    let client = &state.http_client;
    let key = state.config.google_books_api_key.as_deref();
    let mut book: Option<IsbnBook> = None;
    let sources: [(&str, SourceFuture<'_>); 4] = [
        ("google_books", Box::pin(google_books(client, key, isbn))),
        ("open_library", Box::pin(open_library(client, isbn))),
        ("bnf", Box::pin(bnf(client, isbn))),
        ("openbd", Box::pin(openbd(client, isbn))),
    ];
    for (name, fut) in sources {
        match tokio::time::timeout(SOURCE_TIMEOUT, fut).await {
            Ok(Ok(Some(found))) => {
                book = Some(found);
                break;
            }
            Ok(Ok(None)) => {}
            Ok(Err(err)) => tracing::warn!(source = name, isbn, %err, "isbn source failed"),
            Err(_) => tracing::warn!(source = name, isbn, "isbn source timed out"),
        }
    }

    let source = book.as_ref().map(|b| b.source.clone());
    let payload = book.as_ref().and_then(|b| serde_json::to_string(b).ok());
    let row = isbn_cache::ActiveModel {
        isbn: Set(isbn.to_string()),
        found: Set(book.is_some()),
        source: Set(source.clone()),
        payload: Set(payload),
        fetched_at: Set(now),
    };
    CacheEntity::insert(row)
        .on_conflict(
            OnConflict::column(isbn_cache::Column::Isbn)
                .update_columns([
                    isbn_cache::Column::Found,
                    isbn_cache::Column::Source,
                    isbn_cache::Column::Payload,
                    isbn_cache::Column::FetchedAt,
                ])
                .to_owned(),
        )
        .exec(&state.db)
        .await
        .map_err(AppError::from)?;

    Ok(ResolveOutcome {
        isbn: isbn.to_string(),
        found: book.is_some(),
        book,
        source,
        cached: false,
    })
}

/* ── sources ─────────────────────────────────────────────────────────── */

async fn google_books(
    client: &reqwest::Client,
    key: Option<&str>,
    isbn: &str,
) -> anyhow::Result<Option<IsbnBook>> {
    let mut req = client
        .get("https://www.googleapis.com/books/v1/volumes")
        .query(&[("q", format!("isbn:{isbn}")), ("maxResults", "1".into())])
        .header("User-Agent", USER_AGENT);
    if let Some(k) = key {
        req = req.query(&[("key", k)]);
    }
    let text = req.send().await?.error_for_status()?.text().await?;
    Ok(parse_google(&text, isbn))
}

async fn open_library(client: &reqwest::Client, isbn: &str) -> anyhow::Result<Option<IsbnBook>> {
    let text = client
        .get("https://openlibrary.org/search.json")
        .query(&[
            ("isbn", isbn),
            (
                "fields",
                "title,subtitle,author_name,publisher,first_publish_year,number_of_pages_median,language,cover_i",
            ),
            ("limit", "1"),
        ])
        .header("User-Agent", USER_AGENT)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    Ok(parse_open_library(&text, isbn))
}

async fn bnf(client: &reqwest::Client, isbn: &str) -> anyhow::Result<Option<IsbnBook>> {
    let text = client
        .get("https://catalogue.bnf.fr/api/SRU")
        .query(&[
            ("version", "1.2"),
            ("operation", "searchRetrieve"),
            ("query", &format!("bib.isbn adj \"{isbn}\"")),
            ("recordSchema", "dublincore"),
            ("maximumRecords", "1"),
        ])
        .header("User-Agent", USER_AGENT)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    Ok(parse_bnf(&text, isbn))
}

async fn openbd(client: &reqwest::Client, isbn: &str) -> anyhow::Result<Option<IsbnBook>> {
    let text = client
        .get("https://api.openbd.jp/v1/get")
        .query(&[("isbn", isbn)])
        .header("User-Agent", USER_AGENT)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    Ok(parse_openbd(&text, isbn))
}

/* ── parsers (pure, tested) ──────────────────────────────────────────── */

fn str_of(v: &serde_json::Value) -> Option<String> {
    v.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
}

fn strings_of(v: &serde_json::Value) -> Vec<String> {
    v.as_array()
        .map(|a| a.iter().filter_map(str_of).collect())
        .unwrap_or_default()
}

fn https(url: String) -> String {
    match url.strip_prefix("http://") {
        Some(rest) => format!("https://{rest}"),
        None => url,
    }
}

pub fn parse_google(text: &str, isbn: &str) -> Option<IsbnBook> {
    let data: serde_json::Value = serde_json::from_str(text).ok()?;
    let item = data.get("items")?.as_array()?.first()?;
    let info = item.get("volumeInfo")?;
    let title = str_of(&info["title"])?;
    let sale = &item["saleInfo"];
    let picked = if sale["retailPrice"].is_object() {
        &sale["retailPrice"]
    } else {
        &sale["listPrice"]
    };
    let price = match (picked["amount"].as_f64(), str_of(&picked["currencyCode"])) {
        (Some(amount), Some(currency)) if amount > 0.0 => Some(IsbnPrice { amount, currency }),
        _ => None,
    };
    let links = &info["imageLinks"];
    let cover = str_of(&links["extraLarge"])
        .or_else(|| str_of(&links["large"]))
        .or_else(|| str_of(&links["thumbnail"]))
        .or_else(|| str_of(&links["smallThumbnail"]))
        .map(https);
    Some(IsbnBook {
        isbn: isbn.to_string(),
        title,
        subtitle: str_of(&info["subtitle"]),
        authors: strings_of(&info["authors"]),
        publisher: str_of(&info["publisher"]),
        published: str_of(&info["publishedDate"]),
        page_count: info["pageCount"]
            .as_i64()
            .map(|n| n as i32)
            .filter(|n| *n > 0),
        language: str_of(&info["language"]),
        cover,
        description: str_of(&info["description"]),
        price,
        source: "google_books".into(),
    })
}

pub fn parse_open_library(text: &str, isbn: &str) -> Option<IsbnBook> {
    let data: serde_json::Value = serde_json::from_str(text).ok()?;
    let doc = data.get("docs")?.as_array()?.first()?;
    let title = str_of(&doc["title"])?;
    let cover = doc["cover_i"]
        .as_i64()
        .filter(|id| *id > 0)
        .map(|id| format!("https://covers.openlibrary.org/b/id/{id}-L.jpg"));
    Some(IsbnBook {
        isbn: isbn.to_string(),
        title,
        subtitle: str_of(&doc["subtitle"]),
        authors: strings_of(&doc["author_name"]),
        publisher: strings_of(&doc["publisher"]).into_iter().next(),
        published: doc["first_publish_year"].as_i64().map(|y| y.to_string()),
        page_count: doc["number_of_pages_median"]
            .as_i64()
            .map(|n| n as i32)
            .filter(|n| *n > 0),
        language: strings_of(&doc["language"]).into_iter().next(),
        cover,
        description: None,
        price: None,
        source: "open_library".into(),
    })
}

/// SRU 1.2 + Dublin Core: one `<srw:record>` with `dc:*` children. Repeated
/// elements (several creators) are kept in order; `numberOfRecords` 0
/// means an honest miss.
pub fn parse_bnf(xml: &str, isbn: &str) -> Option<IsbnBook> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut fields: std::collections::HashMap<String, Vec<String>> = Default::default();
    let mut current: Option<String> = None;
    let mut text = String::new();
    let mut records: Option<u32> = None;
    loop {
        match reader.read_event() {
            Err(_) | Ok(Event::Eof) => break,
            Ok(Event::Start(e)) => {
                let local = e.local_name();
                let local: &str = local.as_ref();
                if matches!(
                    local,
                    "title"
                        | "creator"
                        | "contributor"
                        | "publisher"
                        | "date"
                        | "language"
                        | "format"
                        | "description"
                        | "numberOfRecords"
                ) {
                    current = Some(local.to_string());
                    text.clear();
                }
            }
            Ok(Event::Text(t)) => {
                if current.is_some() {
                    let raw: &str = &t;
                    match quick_xml::escape::unescape(raw) {
                        Ok(s) => text.push_str(&s),
                        Err(_) => text.push_str(raw),
                    }
                }
            }
            Ok(Event::CData(c)) => {
                if current.is_some() {
                    text.push_str(&c);
                }
            }
            Ok(Event::GeneralRef(r)) => {
                if current.is_some() {
                    let name: &str = &r;
                    match name {
                        "amp" => text.push('&'),
                        "lt" => text.push('<'),
                        "gt" => text.push('>'),
                        "quot" => text.push('"'),
                        "apos" => text.push('\''),
                        _ => {
                            if let Ok(Some(ch)) = r.resolve_char_ref() {
                                text.push(ch);
                            }
                        }
                    }
                }
            }
            Ok(Event::End(_)) => {
                if let Some(name) = current.take() {
                    let value = text.trim().to_string();
                    if name == "numberOfRecords" {
                        records = value.parse().ok();
                    } else if !value.is_empty() {
                        fields.entry(name).or_default().push(value);
                    }
                    text.clear();
                }
            }
            Ok(_) => {}
        }
    }
    if records == Some(0) {
        return None;
    }
    let title = fields.get("title")?.first()?.clone();
    // BnF creators read "Oda, Eiichiro (1975-....). Auteur du texte" —
    // keep the name, drop the dates and the role.
    let authors: Vec<String> = fields
        .get("creator")
        .map(|v| {
            v.iter()
                .map(|c| clean_bnf_name(c))
                .filter(|c| !c.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let page_count = fields
        .get("format")
        .and_then(|v| v.iter().find_map(|f| pages_in(f)));
    Some(IsbnBook {
        isbn: isbn.to_string(),
        title,
        subtitle: None,
        authors,
        publisher: fields.get("publisher").and_then(|v| v.first().cloned()),
        published: fields.get("date").and_then(|v| v.first().cloned()),
        page_count,
        language: fields.get("language").and_then(|v| v.first().cloned()),
        cover: None,
        description: fields.get("description").and_then(|v| v.first().cloned()),
        price: None,
        source: "bnf".into(),
    })
}

fn clean_bnf_name(raw: &str) -> String {
    let no_role = raw.split(". ").next().unwrap_or(raw);
    let no_dates = match no_role.find(" (") {
        Some(i) => &no_role[..i],
        None => no_role,
    };
    no_dates.trim().trim_end_matches(',').to_string()
}

/// "1 vol. (192 p.) : ill. ; 18 cm" → 192
fn pages_in(format: &str) -> Option<i32> {
    let idx = format.find(" p.")?;
    let head = &format[..idx];
    let digits: String = head
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    digits.parse().ok().filter(|n: &i32| *n > 0)
}

pub fn parse_openbd(text: &str, isbn: &str) -> Option<IsbnBook> {
    let data: serde_json::Value = serde_json::from_str(text).ok()?;
    let entry = data.as_array()?.first()?;
    let summary = entry.get("summary")?;
    let title = str_of(&summary["title"])?;
    let authors = str_of(&summary["author"])
        .map(|a| {
            a.split(['／', '/'])
                .map(str::trim)
                .filter(|s| !s.is_empty() && !matches!(*s, "著" | "作" | "原作" | "画"))
                .map(String::from)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Some(IsbnBook {
        isbn: isbn.to_string(),
        title,
        subtitle: str_of(&summary["volume"]),
        authors,
        publisher: str_of(&summary["publisher"]),
        published: str_of(&summary["pubdate"]),
        page_count: None,
        language: Some("ja".into()),
        cover: str_of(&summary["cover"]).map(https),
        description: None,
        price: None,
        source: "openbd".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ISBN: &str = "9780306406157";

    #[test]
    fn cache_ttl_is_long_for_hits_and_short_for_misses() {
        let now = Utc::now();
        assert!(cache_is_fresh(true, now - chrono::Duration::days(29), now));
        assert!(!cache_is_fresh(true, now - chrono::Duration::days(31), now));
        assert!(cache_is_fresh(
            false,
            now - chrono::Duration::hours(23),
            now
        ));
        assert!(!cache_is_fresh(
            false,
            now - chrono::Duration::hours(25),
            now
        ));
    }

    #[test]
    fn google_volume_is_normalised_with_price_and_https_cover() {
        let json = r#"{"items":[{"volumeInfo":{"title":"One Piece, Vol. 1","subtitle":"Romance Dawn","authors":["Eiichiro Oda"],"publisher":"VIZ Media","publishedDate":"2003-06-01","pageCount":216,"language":"en","description":"A pirate story.","imageLinks":{"smallThumbnail":"http://books.google.com/s.jpg","thumbnail":"http://books.google.com/t.jpg"}},"saleInfo":{"listPrice":{"amount":9.99,"currencyCode":"USD"},"retailPrice":{"amount":7.49,"currencyCode":"USD"}}}]}"#;
        let b = parse_google(json, ISBN).unwrap();
        assert_eq!(b.title, "One Piece, Vol. 1");
        assert_eq!(b.subtitle.as_deref(), Some("Romance Dawn"));
        assert_eq!(b.authors, vec!["Eiichiro Oda"]);
        assert_eq!(b.page_count, Some(216));
        assert_eq!(b.cover.as_deref(), Some("https://books.google.com/t.jpg"));
        assert_eq!(
            b.price,
            Some(IsbnPrice {
                amount: 7.49,
                currency: "USD".into()
            })
        );
        assert_eq!(b.source, "google_books");
        assert!(parse_google(r#"{"totalItems":0}"#, ISBN).is_none());
    }

    #[test]
    fn open_library_doc_is_normalised() {
        let json = r#"{"docs":[{"title":"One Piece","subtitle":"Tome 1","author_name":["Eiichiro Oda"],"publisher":["Glénat","Glenat"],"first_publish_year":2000,"number_of_pages_median":192,"language":["fre"],"cover_i":12345}]}"#;
        let b = parse_open_library(json, ISBN).unwrap();
        assert_eq!(b.publisher.as_deref(), Some("Glénat"));
        assert_eq!(b.published.as_deref(), Some("2000"));
        assert_eq!(b.language.as_deref(), Some("fre"));
        assert_eq!(
            b.cover.as_deref(),
            Some("https://covers.openlibrary.org/b/id/12345-L.jpg")
        );
        assert!(parse_open_library(r#"{"docs":[]}"#, ISBN).is_none());
    }

    #[test]
    fn bnf_dublin_core_record_is_normalised() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/">
  <srw:numberOfRecords>1</srw:numberOfRecords>
  <srw:records><srw:record><srw:recordData><oai_dc:dc>
    <dc:title>One piece. 1, Romance dawn &amp; co</dc:title>
    <dc:creator>Oda, Eiichiro (1975-....). Auteur du texte</dc:creator>
    <dc:publisher>Glénat</dc:publisher>
    <dc:date>2013</dc:date>
    <dc:language>fre</dc:language>
    <dc:format>1 vol. (192 p.) : ill. ; 18 cm</dc:format>
  </oai_dc:dc></srw:recordData></srw:record></srw:records>
</srw:searchRetrieveResponse>"#;
        let b = parse_bnf(xml, ISBN).unwrap();
        assert_eq!(b.title, "One piece. 1, Romance dawn & co");
        assert_eq!(b.authors, vec!["Oda, Eiichiro"]);
        assert_eq!(b.publisher.as_deref(), Some("Glénat"));
        assert_eq!(b.published.as_deref(), Some("2013"));
        assert_eq!(b.page_count, Some(192));
        assert_eq!(b.source, "bnf");
        let none = r#"<srw:searchRetrieveResponse xmlns:srw="x"><srw:numberOfRecords>0</srw:numberOfRecords></srw:searchRetrieveResponse>"#;
        assert!(parse_bnf(none, ISBN).is_none());
    }

    #[test]
    fn openbd_summary_is_normalised() {
        let json = r#"[{"summary":{"isbn":"9784088725093","title":"ONE PIECE 1","volume":"1","publisher":"集英社","pubdate":"19971204","cover":"http://cover.openbd.jp/9784088725093.jpg","author":"尾田栄一郎／著"}}]"#;
        let b = parse_openbd(json, "9784088725093").unwrap();
        assert_eq!(b.title, "ONE PIECE 1");
        assert_eq!(b.authors, vec!["尾田栄一郎"]);
        assert_eq!(b.publisher.as_deref(), Some("集英社"));
        assert_eq!(
            b.cover.as_deref(),
            Some("https://cover.openbd.jp/9784088725093.jpg")
        );
        assert_eq!(b.language.as_deref(), Some("ja"));
        assert!(parse_openbd("[null]", ISBN).is_none());
    }
}
