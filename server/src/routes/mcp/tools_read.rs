//! Read-only tools: the library, its volumes, loans, places and
//! upcoming releases.
//!
//! Each one is a thin wrapper: authorize → call a `crate::services`
//! function with the caller's own `user_id` → hand the result to
//! `Call::finish`. No SQL, and no re-derived business rules.

use rmcp::{
    ErrorData, handler::server::wrapper::Parameters, model::CallToolResult,
    service::RequestContext, tool, tool_router,
};

use super::ctx;
use super::dto::{self, Page};
use super::server::McMcp;
use crate::errors::AppError;
use crate::services::api_keys::Scope;
use crate::services::{activity, library, loan_history, locations, releases, volume};

#[tool_router(router = tool_router_read, vis = "pub")]
impl McMcp {
    // ────────────────────────────────────────────────────── library

    #[tool(
        description = "Search the caller's manga library by title fragment. Returns one page of series with `count` and `has_more` — page on with `offset` rather than reporting a full page as the whole collection. An empty query returns the whole library.",
        annotations(
            title = "Search the library",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn search_library(
        &self,
        Parameters(input): Parameters<dto::SearchLibrary>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "search_library",
            Scope::LibraryRead,
            &input,
        )
        .await?;
        let limit = dto::clamp_limit(input.limit);
        let offset = dto::clamp_offset(input.offset);
        let query = input.q.unwrap_or_default();
        // The search service returns every match; the page is sliced
        // from it, so `total` here is exact.
        let page = library::search(&self.state.db, call.user_id(), &query)
            .await
            .map(|rows| Page::slice(rows, limit, offset));
        call.finish(page).await
    }

    #[tool(
        description = "List the caller's series, optionally filtered by reading status — one of `planned`, `reading`, `paused`, `completed`, `dropped`. One page at a time.",
        annotations(title = "List series", read_only_hint = true, idempotent_hint = true)
    )]
    async fn list_series(
        &self,
        Parameters(input): Parameters<dto::ListSeries>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call =
            ctx::authorize(&self.state, &ctx, "list_series", Scope::LibraryRead, &input).await?;
        let limit = dto::clamp_limit(input.limit);
        let offset = dto::clamp_offset(input.offset);
        let wanted = input.reading_status.map(|s| s.trim().to_lowercase());
        let page = library::get_user_library(&self.state.db, call.user_id())
            .await
            .map(|rows| {
                let rows = match &wanted {
                    Some(status) => rows
                        .into_iter()
                        .filter(|r| r.reading_status.as_deref() == Some(status.as_str()))
                        .collect(),
                    None => rows,
                };
                Page::slice(rows, limit, offset)
            });
        call.finish(page).await
    }

    #[tool(
        description = "Fetch one series in full: title, author, publisher, edition, genres, how many tomes exist and how many the caller owns, reading status and dates.",
        annotations(
            title = "Series details",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn get_series(
        &self,
        Parameters(input): Parameters<dto::SeriesRef>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call =
            ctx::authorize(&self.state, &ctx, "get_series", Scope::LibraryRead, &input).await?;
        let found = library::get_user_manga(&self.state.db, input.mal_id, call.user_id())
            .await
            .and_then(|rows| {
                rows.into_iter()
                    .next()
                    .ok_or_else(|| AppError::NotFound("That series is not in this library.".into()))
            });
        call.finish(found).await
    }

    // ────────────────────────────────────────────────────── volumes

    #[tool(
        description = "List every tome of a series with its number, whether the caller owns it, whether it has been read, its price, condition, shelf location and ISBN. Owning and having read are independent — do not infer one from the other.",
        annotations(
            title = "Series volumes",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn get_volumes(
        &self,
        Parameters(input): Parameters<dto::SeriesRef>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call =
            ctx::authorize(&self.state, &ctx, "get_volumes", Scope::LibraryRead, &input).await?;
        let rows = volume::get_all_for_user_by_mal_id(&self.state.db, call.user_id(), input.mal_id)
            .await
            .map(Page::whole);
        call.finish(rows).await
    }

    #[tool(
        description = "The gaps in a series: every tome already released that the caller does not own, by number. Announced tomes with a future release date are excluded — they are not missing, they do not exist yet.",
        annotations(
            title = "Missing volumes",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn missing_volumes(
        &self,
        Parameters(input): Parameters<dto::SeriesRef>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "missing_volumes",
            Scope::LibraryRead,
            &input,
        )
        .await?;
        let now = chrono::Utc::now();
        let missing =
            volume::get_all_for_user_by_mal_id(&self.state.db, call.user_id(), input.mal_id)
                .await
                .map(|rows| {
                    let mut nums: Vec<i32> = rows
                        .into_iter()
                        // An unreleased tome is not a gap in the collection.
                        .filter(|v| !v.owned && v.release_date.is_none_or(|d| d <= now))
                        .map(|v| v.vol_num)
                        .collect();
                    nums.sort_unstable();
                    serde_json::json!({
                        "mal_id": input.mal_id,
                        "missing_count": nums.len(),
                        "missing": nums,
                    })
                });
        call.finish(missing).await
    }

    // ──────────────────────────────────────────────────────── loans

    #[tool(
        description = "Every tome the caller has currently lent out, with who has it and since when. Empty when nothing is lent.",
        annotations(
            title = "Outstanding loans",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn list_loans(
        &self,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(&self.state, &ctx, "list_loans", Scope::LoansRead, &()).await?;
        let rows = volume::list_active_loans(&self.state.db, call.user_id())
            .await
            .map(Page::whole);
        call.finish(rows).await
    }

    #[tool(
        description = "The loan ledger, newest first: every tome ever lent, to whom, when it went and when it came back. An open row has no return date. This is append-only history — a tome no longer in the library still appears.",
        annotations(title = "Loan history", read_only_hint = true, idempotent_hint = true)
    )]
    async fn loan_history(
        &self,
        Parameters(input): Parameters<dto::LoanHistory>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call =
            ctx::authorize(&self.state, &ctx, "loan_history", Scope::LoansRead, &input).await?;
        let limit = dto::clamp_limit(input.limit);
        let offset = dto::clamp_offset(input.offset);
        // Ask the service for the window plus what we skip, then slice:
        // the ledger is bounded per user and this keeps one code path.
        let fetch = u64::from(limit) + u64::from(offset);
        let rows = loan_history::list(&self.state.db, call.user_id(), input.mal_id, fetch)
            .await
            .map(|rows| Page::slice(rows, limit, offset));
        call.finish(rows).await
    }

    // ──────────────────────────────────────────────────────── places

    #[tool(
        description = "The places registry: every shelf, box or room the caller has named, with how many tomes are filed there, plus the count of owned tomes filed nowhere.",
        annotations(title = "List places", read_only_hint = true, idempotent_hint = true)
    )]
    async fn list_locations(
        &self,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "list_locations",
            Scope::LocationsRead,
            &(),
        )
        .await?;
        let rows = locations::list(&self.state.db, call.user_id()).await;
        call.finish(rows).await
    }

    // ────────────────────────────────────────────────────── releases

    #[tool(
        description = "Upcoming tomes of series the caller follows, by release date, from the start of this month onward.",
        annotations(
            title = "Upcoming volumes",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn upcoming_volumes(
        &self,
        Parameters(input): Parameters<dto::UpcomingVolumes>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "upcoming_volumes",
            Scope::ReleasesRead,
            &input,
        )
        .await?;
        let months = i64::from(input.months.unwrap_or(6).clamp(1, 24));
        let from = chrono::Utc::now();
        let until = from + chrono::Duration::days(30 * months);
        let rows = releases::list_user_calendar(&self.state.db, call.user_id(), from, until)
            .await
            .map(Page::whole);
        call.finish(rows).await
    }

    // ────────────────────────────────────────────────────────── isbn

    #[tool(
        description = "Resolve an ISBN-10 or ISBN-13 to book metadata through the server's catalogue chain (Google Books, Open Library, BnF, openBD). Answers `found: false` rather than failing when no catalogue knows it. Results are cached, so repeating a lookup costs nothing upstream.",
        annotations(
            title = "Resolve an ISBN",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn resolve_isbn(
        &self,
        Parameters(input): Parameters<dto::ResolveIsbn>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call =
            ctx::authorize(&self.state, &ctx, "resolve_isbn", Scope::IsbnRead, &input).await?;
        let outcome = match crate::util::isbn::normalize_isbn13(&input.isbn) {
            Some(isbn) => crate::services::isbn_resolver::resolve(&self.state, &isbn).await,
            None => Err(AppError::BadRequest(
                "Not a valid ISBN-10 or ISBN-13.".into(),
            )),
        };
        call.finish(outcome).await
    }

    // ─────────────────────────────────────────────────────── stats

    #[tool(
        description = "The caller's own activity feed, newest first: series added or removed, tomes marked owned or read, milestones reached. This is the app's own log of what happened, not the MCP audit trail.",
        annotations(
            title = "Recent activity",
            read_only_hint = true,
            idempotent_hint = true
        )
    )]
    async fn recent_activity(
        &self,
        Parameters(input): Parameters<dto::RecentActivity>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "recent_activity",
            Scope::StatsRead,
            &input,
        )
        .await?;
        let limit = u64::from(input.limit.unwrap_or(30).clamp(1, 100));
        let rows = activity::list_for_user(&self.state.db, call.user_id(), limit, None)
            .await
            .map(Page::whole);
        call.finish(rows).await
    }
}
