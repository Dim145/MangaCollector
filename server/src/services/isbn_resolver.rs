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
    /// 叢 · The series this book belongs to, when the catalogue says so
    /// — "One Piece", not "Droit devant !!". This is what turns a
    /// barcode into a shelf entry rather than a lone book.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub series: Option<String>,
    /// Its number within that series.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume: Option<i32>,
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
                // 叢 · `series` is read by the parser below; leaving it
                // out of this list made that branch dead and sent every
                // Open Library answer through the title heuristic.
                "title,subtitle,author_name,publisher,first_publish_year,number_of_pages_median,language,cover_i,series",
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
            // 叢 · UNIMARC, not Dublin Core: the series and the volume
            // number live in 225 $a/$v and 461 $t/$v, and Dublin Core
            // flattens them away. It also gives cleaner authors (700 $a
            // + $b rather than a statement of responsibility) and the
            // cover price.
            ("recordSchema", "unimarcxchange"),
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

/// 叢 · Pull a series and a volume number out of a book title.
///
/// Catalogues that have no series field still write it into the title,
/// and publishers are consistent about it: "One Piece, Tome 15",
/// "Blacksad - Tome 3", "Naruto, Vol. 7", "Berserk #12". When a title
/// ends that way, the part before the separator is the series and the
/// number is the volume.
///
/// Deliberately narrow. It fires only on an explicit volume word or a
/// hash, never on a bare trailing number — "Akira 2" could be a second
/// volume or a title, and guessing wrong renames someone's shelf.
pub fn split_title_series(title: &str) -> Option<(String, i32)> {
    const MARKERS: [&str; 9] = [
        "tome", "tomo", "volume", "vol.", "band", "deel", "t.", "#", "t",
    ];
    // 字 · ASCII-lowered, deliberately: every marker is ASCII, and
    // `to_lowercase` is not length-preserving — `İ` (U+0130) grows from
    // two bytes to three, `K` (U+212A) shrinks from three to one. The
    // marker is found in this copy and the cut is made in `title`, so
    // the two have to agree byte for byte or the knife lands inside a
    // character, which panics.
    let lower = title.to_ascii_lowercase();
    for marker in MARKERS {
        let Some(at) = lower.rfind(marker) else {
            continue;
        };
        // The marker has to start a word. Without this, the bare "t"
        // that catches the French "Golden City T09" would also cut
        // "Bat 21" into "Ba" — and a shelf named "Ba" is worse than one
        // that was never split.
        let starts_word = at == 0
            || lower[..at]
                .chars()
                .next_back()
                .is_some_and(|c| !c.is_alphanumeric());
        if !starts_word {
            continue;
        }
        // What follows the marker must be a number, and nothing else.
        let rest = title[at + marker.len()..].trim();
        let number: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if number.is_empty() || !rest[number.len()..].trim().is_empty() {
            continue;
        }
        let head = title[..at]
            .trim()
            .trim_end_matches([',', '-', '\u{2013}', ':', '\u{00b7}'])
            .trim();
        if head.is_empty() {
            continue;
        }
        let volume: i32 = number.parse().ok()?;
        return Some((head.to_string(), volume));
    }
    None
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
    // 叢 · Google carries the position in a series (`orderNumber`) but
    // not the series' name — only an opaque `seriesId`. So the number
    // comes from there when it is there, and the name from the title,
    // which is where an edition writes it anyway.
    let ordered = info["seriesInfo"]["volumeSeries"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|entry| entry["orderNumber"].as_i64())
        // `as i32` wraps: 2_147_483_648 would come back as a volume
        // number of -2_147_483_648.
        .and_then(|n| i32::try_from(n).ok())
        .filter(|n| *n > 0);
    let from_title = split_title_series(&title);
    let series = from_title.as_ref().map(|(name, _)| name.clone());
    let volume = ordered.or_else(|| from_title.as_ref().map(|(_, n)| *n));

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
        series,
        volume,
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
    // 叢 · Open Library writes the series as one string: "Naruto #3",
    // sometimes "Naruto, Vol. 3". Same shape as a title, same reading.
    let from_series = strings_of(&doc["series"])
        .into_iter()
        .find_map(|entry| split_title_series(&entry).or(Some((entry, 0))))
        .and_then(|(name, n)| (!name.is_empty()).then_some((name, n)));
    let from_title = split_title_series(&title);
    let series = from_series
        .as_ref()
        .map(|(name, _)| name.clone())
        .or_else(|| from_title.as_ref().map(|(name, _)| name.clone()));
    let volume = from_series
        .as_ref()
        .map(|(_, n)| *n)
        .filter(|n| *n > 0)
        .or_else(|| from_title.as_ref().map(|(_, n)| *n));
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
        series,
        volume,
        source: "open_library".into(),
    })
}

/// 叢 · SRU 1.2 + UNIMARC (MarcXchange). One `<srw:record>` per hit;
/// `numberOfRecords` 0 is an honest miss.
///
/// Dublin Core, which this used to ask for, flattens a record into
/// `dc:title` / `dc:creator` and throws away the one thing a shelf
/// needs: which series the book belongs to and where it sits in it.
/// UNIMARC keeps them in named subfields, and gives better answers for
/// everything else too — the author as surname + given name rather than
/// a sentence ("traduit du japonais par…"), the publisher alone rather
/// than a place-and-date string, and the cover price.
///
/// The fields read, and why:
///   010 $a ISBN · $d cover price ("6,90 EUR")
///   101 $a language
///   200 $a title of *this volume* · $e its subtitle
///   210 $c publisher · $d year
///   215 $a extent ("1 vol. (192 p.)")
///   225 $a series · $v number in it · $x ISSN — see below
///   330 $a summary
///   461 $t the set this belongs to · $v number in it
///   700/701/702 $a surname · $b given name
///
/// 225 needs care: a record can carry several, and only one of them is
/// the series. "One Piece / 15" and "Shonen manga / ISSN 1761-2268" sit
/// side by side — the second is the publisher's imprint, which every
/// shōnen in the catalogue shares. The one with a volume number and no
/// ISSN is the series; 461, when present, says the same thing and is
/// preferred because it is a real link to a catalogue record.
pub fn parse_bnf(xml: &str, isbn: &str) -> Option<IsbnBook> {
    use quick_xml::events::Event;

    // (tag, [(code, value)]) in document order.
    let mut fields: Vec<(String, Vec<(u8, String)>)> = Vec::new();
    let mut records: Option<u32> = None;
    let mut tag: Option<String> = None;
    let mut code: Option<u8> = None;
    let mut text = String::new();
    let mut in_records_count = false;

    let mut reader = quick_xml::Reader::from_str(xml);
    loop {
        match reader.read_event() {
            Err(_) | Ok(Event::Eof) => break,
            Ok(Event::Start(e)) => {
                let local = e.local_name();
                let local: &str = local.as_ref();
                match local {
                    "numberOfRecords" => {
                        in_records_count = true;
                        text.clear();
                    }
                    "datafield" => {
                        let t = attr(&e, "tag").unwrap_or_default();
                        fields.push((t.clone(), Vec::new()));
                        tag = Some(t);
                    }
                    "subfield" => {
                        code = attr(&e, "code").and_then(|c| c.bytes().next());
                        text.clear();
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(t)) => {
                let raw: &str = &t;
                match quick_xml::escape::unescape(raw) {
                    Ok(unescaped) => text.push_str(&unescaped),
                    Err(_) => text.push_str(raw),
                }
            }
            // 参 · quick-xml splits text at an entity reference and
            // hands it over as its own event. Without this arm
            // "Black &amp; White" arrives as "Black  White" — and an
            // ampersand is mandatorily escaped in XML, so any title
            // carrying one loses it.
            Ok(Event::GeneralRef(r)) => {
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
            Ok(Event::CData(c)) => text.push_str(&c),
            Ok(Event::End(e)) => {
                let local = e.local_name();
                let local: &str = local.as_ref();
                match local {
                    "numberOfRecords" if in_records_count => {
                        records = text.trim().parse().ok();
                        in_records_count = false;
                        text.clear();
                    }
                    "subfield" => {
                        if let (Some(c), Some(_)) = (code.take(), tag.as_ref()) {
                            let value = text.trim().to_string();
                            if !value.is_empty()
                                && let Some(last) = fields.last_mut()
                            {
                                last.1.push((c, value));
                            }
                        }
                        text.clear();
                    }
                    "datafield" => {
                        tag = None;
                    }
                    _ => {}
                }
            }
            Ok(_) => {}
        }
    }

    if records == Some(0) || fields.is_empty() {
        return None;
    }

    let sub = |t: &str, c: u8| -> Option<String> {
        fields
            .iter()
            .filter(|(ft, _)| ft == t)
            .find_map(|(_, subs)| subs.iter().find(|(sc, _)| *sc == c).map(|(_, v)| v.clone()))
    };

    let title = sub("200", b'a')?;
    let subtitle = sub("200", b'e');

    // 700 is the main author, 701/702 the others (translators included,
    // which is why the role code is not filtered: a manga's 702 is
    // usually its translator, and listing them is not wrong).
    let mut authors: Vec<String> = Vec::new();
    for (t, subs) in &fields {
        if t != "700" && t != "701" && t != "702" {
            continue;
        }
        let surname = subs
            .iter()
            .find(|(c, _)| *c == b'a')
            .map(|(_, v)| v.clone());
        let given = subs
            .iter()
            .find(|(c, _)| *c == b'b')
            .map(|(_, v)| v.clone());
        let name = match (given, surname) {
            (Some(g), Some(s)) => format!("{g} {s}"),
            (None, Some(s)) => s,
            _ => continue,
        };
        if !authors.contains(&name) {
            authors.push(name);
        }
    }
    if authors.is_empty()
        && let Some(statement) = sub("200", b'f')
    {
        authors.push(statement);
    }

    // 461 first — a link to the set's own record — then a 225 that
    // carries a volume number and no ISSN.
    let series_field = fields
        .iter()
        .find(|(t, subs)| t == "461" && subs.iter().any(|(c, _)| *c == b't'))
        .map(|(_, subs)| (subs, b't'))
        .or_else(|| {
            fields
                .iter()
                .find(|(t, subs)| {
                    t == "225"
                        && subs.iter().any(|(c, _)| *c == b'v')
                        && !subs.iter().any(|(c, _)| *c == b'x')
                })
                .map(|(_, subs)| (subs, b'a'))
        });
    let (series, volume) = match series_field {
        Some((subs, name_code)) => {
            let name = subs
                .iter()
                .find(|(c, _)| *c == name_code)
                .map(|(_, v)| v.trim().to_string());
            let number = subs
                .iter()
                .find(|(c, _)| *c == b'v')
                .and_then(|(_, v)| leading_number(v));
            (name.filter(|n| !n.is_empty()), number)
        }
        None => (None, None),
    };

    let price = sub("010", b'd').and_then(|raw| parse_cover_price(&raw));
    let page_count = sub("215", b'a').and_then(|extent| {
        // "1 vol. (192 p.)" — the pagination is the last number.
        extent
            .split(|c: char| !c.is_ascii_digit())
            .rfind(|s| !s.is_empty())
            .and_then(|digits| digits.parse().ok())
    });

    Some(IsbnBook {
        isbn: isbn.to_string(),
        title,
        subtitle,
        authors,
        publisher: sub("210", b'c'),
        published: sub("210", b'd'),
        page_count,
        language: sub("101", b'a'),
        cover: None,
        description: sub("330", b'a'),
        price,
        series,
        volume,
        source: "bnf".into(),
    })
}

/// The value of `name` on a start tag, as a `String`.
fn attr(e: &quick_xml::events::BytesStart<'_>, name: &str) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == name)
        .map(|a| a.value.trim().to_string())
}

/// The integer at the front of a volume statement: "15", "T. 15",
/// "tome 15" all mean fifteen. `None` when there is no number at all.
fn leading_number(raw: &str) -> Option<i32> {
    let digits: String = raw
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

/// "6,90 EUR" → 6.90 EUR. The BnF writes the decimal comma and the
/// currency as a three-letter code after a space.
fn parse_cover_price(raw: &str) -> Option<IsbnPrice> {
    let mut parts = raw.split_whitespace();
    let amount = parts.next()?.replace(',', ".");
    // Three letters or it is not a currency code: the field is free
    // text, and "6,90 euros environ" should not become the currency
    // "EUROS ENVIRON" on a shelf.
    let currency = parts
        .next()
        .map(str::trim)
        .filter(|c| c.len() == 3 && c.chars().all(|ch| ch.is_ascii_alphabetic()))
        .map(str::to_ascii_uppercase)
        .unwrap_or_else(|| "EUR".to_string());
    let amount: f64 = amount.parse().ok()?;
    // `<= 0.0` is false for NaN and for infinity, and "nan" parses.
    // Neither can be written as JSON — both come out `null` — so one
    // would sit in the thirty-day cache as a price with no amount.
    if !amount.is_finite() || amount <= 0.0 {
        return None;
    }
    Some(IsbnPrice { amount, currency })
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
    // 叢 · openBD's summary has no series field; the ONIX block below
    // it does (`Collection` → `TitleElement` with a `PartNumber`), but
    // Japanese editions put the volume in the title just as often, and
    // the title is the one field guaranteed to be there.
    let from_title = split_title_series(&title);
    let series = from_title.as_ref().map(|(name, _)| name.clone());
    let volume = from_title.as_ref().map(|(_, n)| *n);

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
        series,
        volume,
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
    fn bnf_unimarc_record_is_normalised() {
        // A real record, trimmed to the fields the parser reads:
        // One Piece tome 15 in French (Glénat, 2013).
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/" xmlns:mxc="info:lc/xmlns/marcxchange-v2">
  <srw:numberOfRecords>1</srw:numberOfRecords>
  <srw:records><srw:record><srw:recordData><mxc:record>
    <mxc:datafield tag="010" ind1=" " ind2=" "><mxc:subfield code="a">978-2-7234-9260-7</mxc:subfield><mxc:subfield code="b">br.</mxc:subfield><mxc:subfield code="d">6,90 EUR</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="101" ind1="1" ind2=" "><mxc:subfield code="a">fre</mxc:subfield><mxc:subfield code="c">jpn</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="200" ind1="1" ind2=" "><mxc:subfield code="a">Droit devant !!</mxc:subfield><mxc:subfield code="b">Texte imprimé</mxc:subfield><mxc:subfield code="f">Eiichiro Oda</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="210" ind1=" " ind2=" "><mxc:subfield code="a">Grenoble</mxc:subfield><mxc:subfield code="c">Glénat</mxc:subfield><mxc:subfield code="d">2013</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="215" ind1=" " ind2=" "><mxc:subfield code="a">1 vol. (192 p.)</mxc:subfield><mxc:subfield code="d">18 x 13 cm</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="225" ind1="|" ind2=" "><mxc:subfield code="a">One Piece</mxc:subfield><mxc:subfield code="v">15</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="225" ind1="|" ind2=" "><mxc:subfield code="a">Shonen manga</mxc:subfield><mxc:subfield code="x">1761-2268</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="330" ind1=" " ind2=" "><mxc:subfield code="a">Lufy rêve de devenir le roi des pirates.</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="461" ind1=" " ind2="0"><mxc:subfield code="0">38888890</mxc:subfield><mxc:subfield code="t">One piece</mxc:subfield><mxc:subfield code="v">15</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="700" ind1=" " ind2="|"><mxc:subfield code="a">Oda</mxc:subfield><mxc:subfield code="b">Eiichirō</mxc:subfield><mxc:subfield code="4">070</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="702" ind1=" " ind2="|"><mxc:subfield code="a">Rabahi</mxc:subfield><mxc:subfield code="b">Djamel</mxc:subfield><mxc:subfield code="4">730</mxc:subfield></mxc:datafield>
  </mxc:record></srw:recordData></srw:record></srw:records>
</srw:searchRetrieveResponse>"#;
        let b = parse_bnf(xml, ISBN).unwrap();
        // 200 $a is the *volume's* title, not the series'.
        assert_eq!(b.title, "Droit devant !!");
        // 叢 · The prize: which shelf this book belongs on, and where.
        assert_eq!(b.series.as_deref(), Some("One piece"));
        assert_eq!(b.volume, Some(15));
        // Surname + given name, not "traduit du japonais par…".
        assert_eq!(b.authors, vec!["Eiichirō Oda", "Djamel Rabahi"]);
        assert_eq!(b.publisher.as_deref(), Some("Glénat"));
        assert_eq!(b.published.as_deref(), Some("2013"));
        assert_eq!(b.page_count, Some(192));
        assert_eq!(b.language.as_deref(), Some("fre"));
        let price = b.price.unwrap();
        assert_eq!(price.currency, "EUR");
        assert!((price.amount - 6.90).abs() < 0.001);
        assert_eq!(b.source, "bnf");

        let none = r#"<srw:searchRetrieveResponse xmlns:srw="x"><srw:numberOfRecords>0</srw:numberOfRecords></srw:searchRetrieveResponse>"#;
        assert!(parse_bnf(none, ISBN).is_none());
    }

    /// 字 · A title whose case changes length must not move the knife.
    ///
    /// `to_lowercase` is not length-preserving: `İ` (U+0130) is two
    /// bytes and lowercases to three, `K` (U+212A) three to one. The
    /// marker was found in the lowered copy and the cut made in the
    /// original, so the two disagreed by those bytes — at best a
    /// series named half a word, at worst a slice through the middle
    /// of a character, which is a panic, and a 500 on every scan of
    /// that barcode. Open Library is a public wiki: such a title is
    /// something a stranger can write.
    #[test]
    fn a_title_that_changes_length_when_lowercased_is_still_cut_cleanly() {
        assert_eq!(
            split_title_series("İstanbul, Tome 2"),
            Some(("İstanbul".into(), 2))
        );
        // The panic case: a multi-byte character sitting where the
        // offsets drifted apart.
        assert_eq!(split_title_series("İ tomeé"), None);
        assert_eq!(
            split_title_series("KELVIN, Tome 3"),
            Some(("KELVIN".into(), 3))
        );
    }

    /// 参 · An XML entity is not a hole in the text.
    ///
    /// quick-xml splits text at `&amp;…;` and hands the reference over
    /// as its own event, so a parser that only reads `Text` silently
    /// drops it: "Black &amp; White" becomes the series "Black  White".
    #[test]
    fn an_ampersand_in_a_title_survives_the_parser() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/" xmlns:mxc="info:lc/xmlns/marcxchange-v2">
  <srw:numberOfRecords>1</srw:numberOfRecords>
  <srw:records><srw:record><srw:recordData><mxc:record>
    <mxc:datafield tag="200" ind1="1" ind2=" "><mxc:subfield code="a">Black &amp; White</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="225" ind1="|" ind2=" "><mxc:subfield code="a">Caf&#233; &amp; Cie</mxc:subfield><mxc:subfield code="v">4</mxc:subfield></mxc:datafield>
  </mxc:record></srw:recordData></srw:record></srw:records>
</srw:searchRetrieveResponse>"#;
        let b = parse_bnf(xml, ISBN).unwrap();
        assert_eq!(b.title, "Black & White");
        assert_eq!(b.series.as_deref(), Some("Café & Cie"));
        assert_eq!(b.volume, Some(4));
    }

    /// 価 · A price that is not a number is not a price.
    ///
    /// `amount <= 0.0` is false for NaN, so `"nan EUR"` used to pass
    /// straight through. A NaN cannot be written as JSON — it comes out
    /// `null` — so the cached payload would carry a price with no
    /// amount, for the thirty days the hit is kept.
    #[test]
    fn a_price_that_is_not_a_number_is_refused() {
        assert!(parse_cover_price("nan EUR").is_none());
        assert!(parse_cover_price("inf EUR").is_none());
        assert!(parse_cover_price("-inf EUR").is_none());
        assert!(parse_cover_price("0 EUR").is_none());
        // And a currency is three letters or it is not one.
        assert_eq!(parse_cover_price("6,90 EUR").unwrap().currency, "EUR");
        assert_eq!(
            parse_cover_price("6,90 euros environ").unwrap().currency,
            "EUR"
        );
    }

    #[test]
    fn the_publishers_imprint_is_not_the_series() {
        // 225 can appear several times. "Shonen manga" with an ISSN is
        // the imprint every shōnen in the catalogue shares; without the
        // ISSN test, every manga would land on one enormous shelf.
        let xml = r#"<srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/" xmlns:mxc="info:lc/xmlns/marcxchange-v2">
  <srw:numberOfRecords>1</srw:numberOfRecords>
  <srw:records><srw:record><srw:recordData><mxc:record>
    <mxc:datafield tag="200" ind1="1" ind2=" "><mxc:subfield code="a">Un titre</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="225" ind1="|" ind2=" "><mxc:subfield code="a">Shonen manga</mxc:subfield><mxc:subfield code="x">1761-2268</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="225" ind1="|" ind2=" "><mxc:subfield code="a">Vagabond</mxc:subfield><mxc:subfield code="v">T. 7</mxc:subfield></mxc:datafield>
  </mxc:record></srw:recordData></srw:record></srw:records>
</srw:searchRetrieveResponse>"#;
        let b = parse_bnf(xml, ISBN).unwrap();
        assert_eq!(b.series.as_deref(), Some("Vagabond"));
        // "T. 7" — the number is read out of the statement.
        assert_eq!(b.volume, Some(7));
    }

    #[test]
    fn a_book_that_belongs_to_no_series_says_so() {
        let xml = r#"<srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/" xmlns:mxc="info:lc/xmlns/marcxchange-v2">
  <srw:numberOfRecords>1</srw:numberOfRecords>
  <srw:records><srw:record><srw:recordData><mxc:record>
    <mxc:datafield tag="200" ind1="1" ind2=" "><mxc:subfield code="a">L'Étranger</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="210" ind1=" " ind2=" "><mxc:subfield code="c">Gallimard</mxc:subfield></mxc:datafield>
  </mxc:record></srw:recordData></srw:record></srw:records>
</srw:searchRetrieveResponse>"#;
        let b = parse_bnf(xml, ISBN).unwrap();
        assert_eq!(b.title, "L'Étranger");
        assert_eq!(b.series, None);
        assert_eq!(b.volume, None);
    }

    #[test]
    fn a_series_written_into_the_title_is_read_out_of_it() {
        // 叢 · What every catalogue without a series field leaves us.
        for (title, name, number) in [
            ("One Piece, Tome 15", "One Piece", 15),
            ("Blacksad - Tome 3", "Blacksad", 3),
            ("Naruto, Vol. 7", "Naruto", 7),
            ("Berserk #12", "Berserk", 12),
            ("Monster T. 4", "Monster", 4),
            // The French album convention, with no space and no dot.
            ("Golden City T09", "Golden City", 9),
        ] {
            assert_eq!(
                split_title_series(title),
                Some((name.to_string(), number)),
                "{title}"
            );
        }
        // And what it must refuse: a bare number could be part of the
        // title, and renaming someone's shelf on a guess is worse than
        // not splitting at all.
        for title in [
            "Akira 2",
            // A bare "t" must start a word, or this becomes "Ba".
            "Bat 21",
            "Le Chat 9",
            "20th Century Boys",
            "Tome",
            "Vol. ",
            "Tome 3",
            "2001, l'odyssée de l'espace",
        ] {
            assert_eq!(split_title_series(title), None, "{title}");
        }
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
