//! Tool argument types and the paging helper.
//!
//! These derive `JsonSchema`, and `tools/list` publishes the result —
//! so the doc comment on a field is what an agent reads to decide what
//! to put in it. Write them for that reader.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// 型 · Render an optional argument as a plain optional property rather
/// than a nullable one.
///
/// `schemars` turns `Option<T>` into `"type": ["T", "null"]`. That is
/// legal JSON Schema, and the official MCP inspector flags it anyway:
/// several clients read `type` as a single string and either reject the
/// whole tool or silently drop the constraint. Neither failure is one a
/// server would hear about — the tool just stops working for that
/// client.
///
/// Collapsing it is not a white lie. Every optional argument in this
/// module means "leave it alone", never "pass an explicit null" — the
/// fields that genuinely need a third state say it with an empty string
/// (see `tri_state`). So "absent is allowed, and when present it is a
/// `T`" is exactly the contract, and `required` already carries the
/// optionality.
///
/// The `default: null` schemars emits alongside goes too: it is noise
/// that reads as "the default is the null value" rather than "there
/// isn't one".
fn plain_optional(schema: &mut schemars::Schema) {
    if schema
        .get("default")
        .is_some_and(serde_json::Value::is_null)
    {
        schema.remove("default");
    }
    let Some(ty) = schema.get_mut("type") else {
        return;
    };
    let Some(kinds) = ty.as_array() else { return };
    let mut concrete: Vec<serde_json::Value> = kinds
        .iter()
        .filter(|k| k.as_str() != Some("null"))
        .cloned()
        .collect();
    // Only collapse the `T | null` shape. A genuine union of two real
    // types is left alone — rewriting that would change the contract.
    if concrete.len() == 1 {
        *ty = concrete.remove(0);
    }
}

/// Applied to every argument struct below, so nested objects get the
/// same treatment as the top level.
use schemars::transform::RecursiveTransform as Recurse;

/// Largest page any tool will return. A caller that wants more pages on
/// with `offset`; a caller that asks for 10 000 rows gets 200 and a
/// `has_more` telling it the truth.
pub const MAX_LIMIT: u32 = 200;
const DEFAULT_LIMIT: u32 = 50;

pub fn clamp_limit(requested: Option<u32>) -> u32 {
    requested.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

pub fn clamp_offset(requested: Option<u32>) -> u32 {
    requested.unwrap_or(0)
}

/// One page of rows.
///
/// `has_more` is the field that matters and the reason this type exists:
/// an agent handed 50 rows with no signal cannot tell a complete answer
/// from a truncated one, and will report the truncation as the whole
/// collection.
#[derive(Debug, Serialize)]
pub struct Page<T> {
    pub count: usize,
    pub limit: u32,
    pub offset: u32,
    pub has_more: bool,
    /// Exact total when the query produced every match and the page was
    /// sliced from it; `null` when the rows past the page were never
    /// fetched. Never read `count` as a total.
    pub total: Option<usize>,
    pub items: Vec<T>,
}

impl<T> Page<T> {
    /// Slice an already-complete result set. The total is exact here
    /// because every match was in hand.
    pub fn slice(all: Vec<T>, limit: u32, offset: u32) -> Self {
        let total = all.len();
        let items: Vec<T> = all
            .into_iter()
            .skip(offset as usize)
            .take(limit as usize)
            .collect();
        Self {
            count: items.len(),
            limit,
            offset,
            has_more: offset as usize + items.len() < total,
            total: Some(total),
            items,
        }
    }

    /// A whole result set that was never paged. Still carries the
    /// envelope so every tool answers with the same shape.
    pub fn whole(items: Vec<T>) -> Self {
        let count = items.len();
        Self {
            count,
            limit: MAX_LIMIT,
            offset: 0,
            has_more: false,
            total: Some(count),
            items,
        }
    }
}

// ── Arguments ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[schemars(transform = Recurse(plain_optional))]
pub struct SearchLibrary {
    /// Text to look for in the series title. Matching is
    /// case-insensitive and partial; an empty query returns the whole
    /// library, newest first.
    #[serde(default)]
    pub q: Option<String>,
    /// Rows per page, 1-200. Defaults to 50.
    #[serde(default)]
    pub limit: Option<u32>,
    /// Rows to skip. Page on with this while `has_more` is true.
    #[serde(default)]
    pub offset: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[schemars(transform = Recurse(plain_optional))]
pub struct ListSeries {
    /// Only series with this reading status. One of `planned`,
    /// `reading`, `paused`, `completed`, `dropped` — the vocabulary in
    /// `models::library::READING_STATUSES`, which a test below pins
    /// against this very sentence. Omit for all of them.
    #[serde(default)]
    pub reading_status: Option<String>,
    /// Rows per page, 1-200. Defaults to 50.
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[schemars(transform = Recurse(plain_optional))]
pub struct SeriesRef {
    /// The series' MyAnimeList id. Negative ids are this account's own
    /// custom or MangaDex-sourced entries and are equally valid.
    pub mal_id: i32,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[schemars(transform = Recurse(plain_optional))]
pub struct LoanHistory {
    /// Restrict to one series. Omit for the whole ledger.
    #[serde(default)]
    pub mal_id: Option<i32>,
    /// Rows per page, 1-200. Defaults to 50.
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[schemars(transform = Recurse(plain_optional))]
pub struct UpcomingVolumes {
    /// How many months ahead to look. 1-24, defaults to 6.
    #[serde(default)]
    pub months: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[schemars(transform = Recurse(plain_optional))]
pub struct ResolveIsbn {
    /// An ISBN-10 or ISBN-13, with or without separators. Normalised to
    /// ISBN-13 before the lookup.
    pub isbn: String,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[schemars(transform = Recurse(plain_optional))]
pub struct MarkVolumes {
    /// The series to act on.
    pub mal_id: i32,
    /// Set every released tome's owned flag. Omit to leave it alone.
    #[serde(default)]
    pub owned: Option<bool>,
    /// Set every released tome's read state: `true` stamps now, `false`
    /// clears the timestamp. Omit to leave it alone.
    ///
    /// Owning and having read are independent — setting one does not
    /// imply the other.
    #[serde(default)]
    pub read: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[schemars(transform = Recurse(plain_optional))]
pub struct CreateLocation {
    /// The place's name, as it will read on a tome ("bibliothèque du
    /// salon", "carton B"). Naming an existing place returns that one
    /// rather than creating a duplicate.
    pub name: String,
    /// An optional note about the place.
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[schemars(transform = Recurse(plain_optional))]
pub struct DeleteSeries {
    /// The series to remove.
    pub mal_id: i32,
    /// Must be `true`. This removes the series and every tome, loan
    /// record and coffret hanging off it, and there is no undo short of
    /// restoring an archive bundle — so the confirmation is required on
    /// the call itself, on top of the key carrying `library:delete`.
    #[serde(default)]
    pub confirm: bool,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[schemars(transform = Recurse(plain_optional))]
pub struct AddCustomSeries {
    /// The series' title, as the owner wants to see it on the shelf.
    pub name: String,
    /// How many tomes the series has. A row is created for each, all
    /// unowned, so the caller can mark them afterwards.
    pub volumes: i32,
    /// How many of them the caller already owns. Marks that many from
    /// the first tome; omit for none.
    #[serde(default)]
    pub volumes_owned: Option<i32>,
    /// Genres, free text and free-form — a custom series answers to no
    /// catalogue.
    #[serde(default)]
    pub genres: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[schemars(transform = Recurse(plain_optional))]
pub struct CompareWith {
    /// The other collector's public slug — the last segment of their
    /// `/u/{slug}` profile URL.
    pub slug: String,
}

/// Parse a `YYYY-MM-DD` argument.
///
/// Dates cross the wire as strings rather than a `chrono` type: the
/// schema an agent reads then says the format outright, and nothing
/// depends on a `schemars` feature flag to describe it.
pub fn parse_date(raw: &str, field: &str) -> Result<chrono::NaiveDate, crate::errors::AppError> {
    chrono::NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d").map_err(|_| {
        crate::errors::AppError::BadRequest(format!(
            "`{field}` must be a date as YYYY-MM-DD, got \"{raw}\"."
        ))
    })
}

/// Fold an optional string argument into the three-state shape the
/// physical-copy and library patches use.
///
/// Absent leaves the column alone; an empty string clears it; anything
/// else sets it. An agent has no way to send JSON `null` through a typed
/// argument, so the empty string is how "clear this" is expressed — and
/// the tool descriptions say so.
pub fn tri_state(value: Option<String>) -> Option<Option<String>> {
    value.map(|v| {
        let v = v.trim().to_string();
        if v.is_empty() { None } else { Some(v) }
    })
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[schemars(transform = Recurse(plain_optional))]
pub struct SetReadingState {
    /// The series to move.
    pub mal_id: i32,
    /// One of `planned`, `reading`, `paused`, `completed`, `dropped`.
    /// An empty string clears the status; omit to leave it alone.
    #[serde(default)]
    pub status: Option<String>,
    /// When the caller started reading, as `YYYY-MM-DD`.
    #[serde(default)]
    pub started_at: Option<String>,
    /// When they finished, as `YYYY-MM-DD`.
    #[serde(default)]
    pub finished_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[schemars(transform = Recurse(plain_optional))]
pub struct SetPhysicalCopy {
    /// The tome's own id, from `get_volumes` — not its number in the
    /// series.
    pub volume_id: i32,
    /// Condition of the copy. A closed vocabulary, not free text: one
    /// of `new`, `like_new`, `good`, `fair`, `poor`
    /// (`models::volume::VOLUME_CONDITIONS`, pinned by a test). An
    /// empty string clears it.
    #[serde(default)]
    pub condition: Option<String>,
    /// Where it is shelved. Naming a place that does not exist yet
    /// registers it. An empty string unfiles the tome.
    #[serde(default)]
    pub location: Option<String>,
    /// When it was bought, as `YYYY-MM-DD`. An empty string clears it.
    #[serde(default)]
    pub bought_on: Option<String>,
    /// The copy's ISBN-10 or ISBN-13; stored normalised to ISBN-13. An
    /// empty string clears it.
    #[serde(default)]
    pub isbn: Option<String>,
    /// How many spare copies of this tome the caller holds. There is no
    /// "clear" — zero is it.
    #[serde(default)]
    pub extra_copies: Option<i32>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[schemars(transform = Recurse(plain_optional))]
pub struct LendVolume {
    /// The tome's own id, from `get_volumes`.
    pub volume_id: i32,
    /// Who has it. Free text, as the owner would write it.
    pub to: String,
    /// When it is expected back, as `YYYY-MM-DD`. Omit for open-ended.
    #[serde(default)]
    pub due_on: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[schemars(transform = Recurse(plain_optional))]
pub struct VolumeRef {
    /// The tome's own id, from `get_volumes`.
    pub volume_id: i32,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[schemars(transform = Recurse(plain_optional))]
pub struct RecentActivity {
    /// How many entries, 1-100. Defaults to 30.
    #[serde(default)]
    pub limit: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_limit_is_clamped_into_the_window() {
        assert_eq!(clamp_limit(None), DEFAULT_LIMIT);
        assert_eq!(clamp_limit(Some(0)), 1, "zero would return nothing forever");
        assert_eq!(clamp_limit(Some(10_000)), MAX_LIMIT);
        assert_eq!(clamp_limit(Some(25)), 25);
    }

    #[test]
    fn a_sliced_page_reports_more_honestly() {
        let all: Vec<u32> = (0..10).collect();
        let first = Page::slice(all.clone(), 4, 0);
        assert_eq!(first.items, vec![0, 1, 2, 3]);
        assert!(first.has_more);
        assert_eq!(first.total, Some(10));

        let last = Page::slice(all.clone(), 4, 8);
        assert_eq!(last.items, vec![8, 9]);
        assert!(!last.has_more, "the final partial page is not truncated");

        // An offset past the end is empty and says so rather than
        // looking like a complete answer.
        let past = Page::slice(all, 4, 99);
        assert!(past.items.is_empty());
        assert!(!past.has_more);
    }

    #[test]
    fn an_exactly_full_page_that_is_the_whole_set_says_there_is_no_more() {
        let page = Page::slice((0..4).collect::<Vec<u32>>(), 4, 0);
        assert_eq!(page.count, 4);
        assert!(!page.has_more);
    }

    /// Walk a generated schema and collect anything that would make a
    /// strict client unhappy.
    fn portability_complaints(value: &serde_json::Value, path: &str, out: &mut Vec<String>) {
        match value {
            serde_json::Value::Object(map) => {
                if map.get("type").is_some_and(|t| {
                    t.as_array()
                        .is_some_and(|k| k.iter().any(|v| v.as_str() == Some("null")))
                }) {
                    out.push(format!("{path}: `type` is an array containing \"null\""));
                }
                if map.get("default").is_some_and(serde_json::Value::is_null) {
                    out.push(format!("{path}: `default` is null"));
                }
                for (key, child) in map {
                    portability_complaints(child, &format!("{path}.{key}"), out);
                }
            }
            serde_json::Value::Array(items) => {
                for (i, child) in items.iter().enumerate() {
                    portability_complaints(child, &format!("{path}[{i}]"), out);
                }
            }
            _ => {}
        }
    }

    /// An optional argument must publish a single `type`, not `["T",
    /// "null"]`.
    ///
    /// The array form is legal JSON Schema and several MCP clients
    /// mishandle it — some reject the whole tool, some drop the
    /// constraint — and neither failure is one this server would ever
    /// hear about. The official inspector flagged 25 of these across 11
    /// tools before `plain_optional` was applied; this is what stops the
    /// twenty-sixth.
    #[test]
    fn no_argument_schema_publishes_a_nullable_type() {
        let mut complaints = Vec::new();
        // One struct per shape that exists here: plain options, options
        // beside required fields, a Vec option, and a bool.
        for (name, schema) in [
            ("SearchLibrary", schemars::schema_for!(SearchLibrary)),
            ("ListSeries", schemars::schema_for!(ListSeries)),
            ("MarkVolumes", schemars::schema_for!(MarkVolumes)),
            ("SetPhysicalCopy", schemars::schema_for!(SetPhysicalCopy)),
            ("SetReadingState", schemars::schema_for!(SetReadingState)),
            ("LendVolume", schemars::schema_for!(LendVolume)),
            ("AddCustomSeries", schemars::schema_for!(AddCustomSeries)),
            ("DeleteSeries", schemars::schema_for!(DeleteSeries)),
            ("LoanHistory", schemars::schema_for!(LoanHistory)),
            ("UpcomingVolumes", schemars::schema_for!(UpcomingVolumes)),
            ("RecentActivity", schemars::schema_for!(RecentActivity)),
            ("CompareWith", schemars::schema_for!(CompareWith)),
            ("SeriesRef", schemars::schema_for!(SeriesRef)),
            ("VolumeRef", schemars::schema_for!(VolumeRef)),
            ("CreateLocation", schemars::schema_for!(CreateLocation)),
            ("ResolveIsbn", schemars::schema_for!(ResolveIsbn)),
        ] {
            portability_complaints(schema.as_value(), name, &mut complaints);
        }
        assert!(
            complaints.is_empty(),
            "argument schemas a strict MCP client would trip on:\n  {}",
            complaints.join("\n  ")
        );
    }

    /// Collapsing `T | null` must not collapse a genuine union, which
    /// would quietly narrow a contract rather than clarify one.
    #[test]
    fn a_real_union_of_two_types_survives() {
        let mut schema: schemars::Schema =
            serde_json::from_value(serde_json::json!({ "type": ["string", "integer"] }))
                .expect("a valid schema");
        plain_optional(&mut schema);
        assert_eq!(
            schema.get("type"),
            Some(&serde_json::json!(["string", "integer"]))
        );
    }

    #[test]
    fn a_date_argument_is_parsed_or_says_what_it_wanted() {
        assert_eq!(
            parse_date("2026-03-14", "bought_on").unwrap(),
            chrono::NaiveDate::from_ymd_opt(2026, 3, 14).unwrap()
        );
        // Whitespace is the agent's, not the user's.
        assert!(parse_date("  2026-03-14 ", "bought_on").is_ok());
        let err = parse_date("14/03/2026", "bought_on").unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("YYYY-MM-DD"), "{msg}");
        assert!(msg.contains("bought_on"), "the field must be named: {msg}");
    }

    #[test]
    fn tri_state_folds_absent_empty_and_value_apart() {
        // Absent leaves alone, empty clears, text sets. Getting the
        // first two confused is how an agent silently wipes a note.
        assert_eq!(tri_state(None), None);
        assert_eq!(tri_state(Some(String::new())), Some(None));
        assert_eq!(tri_state(Some("   ".into())), Some(None));
        assert_eq!(
            tri_state(Some(" salon ".into())),
            Some(Some("salon".into()))
        );
    }

    #[test]
    fn a_whole_result_set_still_carries_the_envelope() {
        let page = Page::whole(vec!["a", "b"]);
        assert_eq!(page.count, 2);
        assert_eq!(page.total, Some(2));
        assert!(!page.has_more);
    }
}
