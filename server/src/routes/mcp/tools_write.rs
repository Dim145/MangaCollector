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
}
