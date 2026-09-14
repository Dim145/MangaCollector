//! Tool argument types and the paging helper.
//!
//! These derive `JsonSchema`, and `tools/list` publishes the result —
//! so the doc comment on a field is what an agent reads to decide what
//! to put in it. Write them for that reader.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

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
pub struct ListSeries {
    /// Only series with this reading status: `reading`, `completed`,
    /// `on_hold`, `dropped`, `plan_to_read`. Omit for all of them.
    #[serde(default)]
    pub reading_status: Option<String>,
    /// Rows per page, 1-200. Defaults to 50.
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct SeriesRef {
    /// The series' MyAnimeList id. Negative ids are this account's own
    /// custom or MangaDex-sourced entries and are equally valid.
    pub mal_id: i32,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
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
pub struct UpcomingVolumes {
    /// How many months ahead to look. 1-24, defaults to 6.
    #[serde(default)]
    pub months: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct ResolveIsbn {
    /// An ISBN-10 or ISBN-13, with or without separators. Normalised to
    /// ISBN-13 before the lookup.
    pub isbn: String,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
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

    #[test]
    fn a_whole_result_set_still_carries_the_envelope() {
        let page = Page::whole(vec!["a", "b"]);
        assert_eq!(page.count, 2);
        assert_eq!(page.total, Some(2));
        assert!(!page.has_more);
    }
}
