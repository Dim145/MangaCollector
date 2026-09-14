//! Tools that change something.
//!
//! Every one goes through `crate::services::ops`, never straight to a
//! service: `ops` is what carries the realtime fan-out, and a write that
//! skips it leaves the user's open tabs and PWA serving a stale cache
//! with no error anywhere. That is the whole reason the layer exists —
//! see its module header.
//!
//! Each call passes `call.origin()`, an id that matches no websocket, so
//! every one of the user's real devices hears about the change and none
//! is skipped as the author.

use rmcp::{
    ErrorData, handler::server::wrapper::Parameters, model::CallToolResult,
    service::RequestContext, tool, tool_router,
};

use super::ctx;
use super::dto;
use super::server::McMcp;
use crate::models::library::AddCustomRequest;
use crate::models::volume::{LoanPatch, PhysicalPatch};
use crate::services::api_keys::Scope;
use crate::services::ops;

#[tool_router(router = tool_router_write, vis = "pub")]
impl McMcp {
    #[tool(
        description = "Mark every released tome of a series as owned and/or read in one call. `owned` and `read` are independent and each optional: omitting one leaves it alone, and `read: false` clears the read timestamp rather than marking anything unowned. Announced tomes with a future release date are untouched.",
        annotations(title = "Mark volumes", idempotent_hint = true)
    )]
    async fn mark_volumes(
        &self,
        Parameters(input): Parameters<dto::MarkVolumes>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "mark_volumes",
            Scope::VolumesWrite,
            &input,
        )
        .await?;
        // Neither field set is a no-op that would still fire an
        // invalidation at every device. Say so instead.
        if input.owned.is_none() && input.read.is_none() {
            return call
                .refuse("Nothing to do: set `owned`, `read`, or both.")
                .await;
        }
        let origin = call.origin();
        let done = ops::volume::bulk_mark_volumes(
            &self.state,
            call.user_id(),
            input.mal_id,
            input.owned,
            input.read,
            origin,
        )
        .await
        .map(|()| {
            serde_json::json!({
                "mal_id": input.mal_id,
                "owned": input.owned,
                "read": input.read,
                "status": "ok",
            })
        });
        call.finish(done).await
    }

    #[tool(
        description = "Start a series over: one more read-through on the tally, every tome back to unread, status `reading` from today. Ownership is untouched. Reversible only by editing the series back by hand, so do not call it to 'reset' anything else.",
        annotations(title = "Start a re-read")
    )]
    async fn start_reread(
        &self,
        Parameters(input): Parameters<dto::SeriesRef>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "start_reread",
            Scope::LibraryWrite,
            &input,
        )
        .await?;
        let origin = call.origin();
        let done = ops::library::start_reread(&self.state, call.user_id(), input.mal_id, origin)
            .await
            .map(|()| serde_json::json!({ "mal_id": input.mal_id, "status": "ok" }));
        call.finish(done).await
    }

    #[tool(
        description = "Register a place — a shelf, a box, a room — that tomes can be filed under. Naming one that already exists returns it rather than creating a duplicate, so this is safe to call before filing.",
        annotations(title = "Create a place", idempotent_hint = true)
    )]
    async fn create_location(
        &self,
        Parameters(input): Parameters<dto::CreateLocation>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "create_location",
            Scope::LocationsWrite,
            &input,
        )
        .await?;
        let origin = call.origin();
        let row =
            ops::locations::create(&self.state, call.user_id(), &input.name, input.note, origin)
                .await;
        call.finish(row).await
    }

    #[tool(
        description = "Remove a series and everything hanging off it — every tome, its coffrets, and its link to the loan ledger. Requires `confirm: true` on top of the key carrying `library:delete`. There is no undo short of restoring an archive bundle, so read the series back to the user and get their agreement before calling this.",
        annotations(title = "Delete a series", destructive_hint = true)
    )]
    async fn delete_series(
        &self,
        Parameters(input): Parameters<dto::DeleteSeries>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "delete_series",
            Scope::LibraryDelete,
            &input,
        )
        .await?;
        // The scope says this key *may* delete; the confirmation says
        // this *call* meant to. Two different questions, and an agent
        // that reached here by accident fails the second one.
        if !input.confirm {
            return call
                .refuse(
                    "Refused: `delete_series` needs `confirm: true`. This removes the \
                     series and every tome, coffret and loan link with it, and cannot \
                     be undone — check with the account owner first.",
                )
                .await;
        }
        let origin = call.origin();
        let done = ops::library::delete_manga(&self.state, call.user_id(), input.mal_id, origin)
            .await
            .map(|()| serde_json::json!({ "mal_id": input.mal_id, "deleted": true }));
        call.finish(done).await
    }

    #[tool(
        description = "Set where the caller is in a series: reading status and the dates that go with it. Status is one of `planned`, `reading`, `paused`, `completed`, `dropped`; an empty string clears it and omitting it leaves it alone. Dates are YYYY-MM-DD.",
        annotations(title = "Set reading state", idempotent_hint = true)
    )]
    async fn set_reading_state(
        &self,
        Parameters(input): Parameters<dto::SetReadingState>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "set_reading_state",
            Scope::LibraryWrite,
            &input,
        )
        .await?;
        if input.status.is_none() && input.started_at.is_none() && input.finished_at.is_none() {
            return call
                .refuse("Nothing to do: set `status`, `started_at`, `finished_at`, or several.")
                .await;
        }
        let origin = call.origin();
        let done = async {
            let started_at = match input.started_at.as_deref() {
                Some(raw) => Some(dto::parse_date(raw, "started_at")?),
                None => None,
            };
            let finished_at = match input.finished_at.as_deref() {
                Some(raw) => Some(dto::parse_date(raw, "finished_at")?),
                None => None,
            };
            ops::library::set_reading_state(
                &self.state,
                call.user_id(),
                input.mal_id,
                input.status.clone(),
                started_at,
                finished_at,
                origin,
            )
            .await?;
            Ok(serde_json::json!({ "mal_id": input.mal_id, "status": "ok" }))
        }
        .await;
        call.finish(done).await
    }

    #[tool(
        description = "Record the physical facts about one tome: its condition, where it is shelved, when it was bought, its ISBN and how many spare copies there are. Condition is a closed vocabulary, not free text: one of `new`, `like_new`, `good`, `fair`, `poor`. Takes a tome's own `volume_id` (from `get_volumes`), not its number in the series. An empty string clears a field; omitting it leaves it alone. Naming a place that does not exist registers it.",
        annotations(title = "Set physical copy", idempotent_hint = true)
    )]
    async fn set_physical_copy(
        &self,
        Parameters(input): Parameters<dto::SetPhysicalCopy>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "set_physical_copy",
            Scope::VolumesWrite,
            &input,
        )
        .await?;
        let origin = call.origin();
        let done = async {
            let bought_at = match input.bought_on.as_deref().map(str::trim) {
                // The empty string is how "clear it" is said — see
                // `dto::tri_state`; a date only gets parsed when there
                // is one.
                Some("") => Some(None),
                Some(raw) => Some(Some(dto::parse_date(raw, "bought_on")?)),
                None => None,
            };
            let patch = PhysicalPatch {
                condition: dto::tri_state(input.condition.clone()),
                location: dto::tri_state(input.location.clone()),
                extra_copies: input.extra_copies,
                bought_at,
                isbn: dto::tri_state(input.isbn.clone()),
            };
            if patch.is_empty() {
                return Err(crate::errors::AppError::BadRequest(
                    "Nothing to do: set at least one of condition, location, \
                     bought_on, isbn or extra_copies."
                        .into(),
                ));
            }
            ops::volume::set_physical_copy(
                &self.state,
                call.user_id(),
                input.volume_id,
                patch,
                origin,
            )
            .await?;
            Ok(serde_json::json!({ "volume_id": input.volume_id, "status": "ok" }))
        }
        .await;
        call.finish(done).await
    }

    #[tool(
        description = "Lend one tome out. Records who has it and, optionally, when it is expected back (YYYY-MM-DD). The loan also lands in the append-only ledger `loan_history` reads from, so 'already lent N times' stays true.",
        annotations(title = "Lend a volume")
    )]
    async fn lend_volume(
        &self,
        Parameters(input): Parameters<dto::LendVolume>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call =
            ctx::authorize(&self.state, &ctx, "lend_volume", Scope::LoansWrite, &input).await?;
        let origin = call.origin();
        let done = async {
            let due_at = match input.due_on.as_deref() {
                Some(raw) => Some(
                    dto::parse_date(raw, "due_on")?
                        .and_hms_opt(0, 0, 0)
                        .expect("midnight is a valid time")
                        .and_utc(),
                ),
                None => None,
            };
            ops::volume::set_loan(
                &self.state,
                call.user_id(),
                input.volume_id,
                Some(LoanPatch {
                    to: input.to.clone(),
                    due_at,
                    // Linking a loan to a followed account is a social
                    // act with an audience; MCP records the borrower as
                    // free text and leaves that decision to a human.
                    to_user_id: None,
                }),
                origin,
            )
            .await?;
            Ok(serde_json::json!({ "volume_id": input.volume_id, "lent_to": input.to }))
        }
        .await;
        call.finish(done).await
    }

    #[tool(
        description = "Take a lent tome back. Closes the open ledger row with today's date. Does nothing if the tome was not out.",
        annotations(title = "Return a volume", idempotent_hint = true)
    )]
    async fn return_volume(
        &self,
        Parameters(input): Parameters<dto::VolumeRef>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "return_volume",
            Scope::LoansWrite,
            &input,
        )
        .await?;
        let origin = call.origin();
        let done =
            ops::volume::set_loan(&self.state, call.user_id(), input.volume_id, None, origin)
                .await
                .map(|()| serde_json::json!({ "volume_id": input.volume_id, "returned": true }));
        call.finish(done).await
    }

    #[tool(
        description = "Add a series no catalogue knows about — a doujinshi, an artbook, a small-press run. It gets a negative id of its own and is never reconciled against MyAnimeList or MangaDex, so nothing upstream can overwrite it. To add a series that IS in a catalogue, use the web app: picking the right entry needs a search this endpoint deliberately does not expose.",
        annotations(title = "Add a custom series")
    )]
    async fn add_custom_series(
        &self,
        Parameters(input): Parameters<dto::AddCustomSeries>,
        ctx: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let call = ctx::authorize(
            &self.state,
            &ctx,
            "add_custom_series",
            Scope::LibraryWrite,
            &input,
        )
        .await?;
        let origin = call.origin();
        let entry = ops::library::add_custom_entry(
            &self.state,
            call.user_id(),
            AddCustomRequest {
                name: input.name.clone(),
                volumes: input.volumes,
                volumes_owned: input.volumes_owned,
                genres: input.genres.clone(),
            },
            origin,
        )
        .await;
        call.finish(entry).await
    }
}
