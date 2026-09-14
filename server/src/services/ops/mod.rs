//! 書 · Write orchestrations — the write paths that have more than one
//! entry point.
//!
//! A write in this app is rarely one service call. It is a service call
//! *plus* the realtime fan-out that tells the user's other devices to
//! drop their caches, and often a validation, a second service call, or
//! a condition on what actually changed. That assembly used to live in
//! the handlers, which was fine while HTTP was the only way in.
//!
//! It stops being fine the moment a second caller exists. A caller that
//! reaches straight for `services::volume::bulk_mark_for_series` writes
//! the rows and skips the fan-out: the open tabs and the PWA keep
//! serving their Dexie cache until something else invalidates it. The
//! data is right and every screen is wrong, which is the worst shape a
//! bug can take — nothing errors, and the user is the one who notices.
//!
//! So every write path with more than one entry point lives here, and
//! the handlers go back to being the thin HTTP shell they should have
//! been: extract, call one `ops` function, serialise. The `#[cfg(test)]`
//! guard at the bottom of this file holds the line by reading the
//! migrated handlers back and refusing a `broker` reference in them.
//!
//! Handlers whose writes have exactly one caller (snapshots, settings,
//! follows, the compare copy) keep their own fan-out: there is nothing
//! for them to drift from. Move one here the day it gains a second
//! caller, and add it to `MIGRATED` below in the same commit.
//!
//! ## `origin`
//!
//! Every function takes an `origin: Option<String>` — the opaque id of
//! the client instance that caused the write (`X-Client-Id` over HTTP).
//! The websocket handler uses it to skip echoing an event back to the
//! socket that produced it, which already holds the optimistic state.
//! A caller that is not a browser tab passes something that matches no
//! socket, so every real device gets the event and none is skipped.

pub mod library;
pub mod locations;
pub mod volume;

use crate::services::realtime::SyncKind;
use crate::state::AppState;

/// Publish one invalidation per kind, scoped to `mal_id`, attributed to
/// `origin`.
///
/// Order is preserved and it matters: clients act on events as they
/// arrive, so `Library` before `Volumes` is what stops a series counter
/// from rendering against volume rows that have not been refetched yet.
pub(crate) async fn fan_out(
    state: &AppState,
    user_id: i32,
    origin: &Option<String>,
    mal_id: Option<i32>,
    kinds: &[SyncKind],
) {
    for kind in kinds {
        state
            .broker
            .publish_scoped(user_id, *kind, mal_id, origin.clone())
            .await;
    }
}

#[cfg(test)]
mod guard_tests {
    //! 番 · The invariant this module exists for, held by reading the
    //! handlers back.
    //!
    //! Same idea as the client's cross-language parity suites: assert
    //! against the source rather than against a mock, and self-skip when
    //! the file is absent so a partial checkout still runs green.

    /// Handlers that have been migrated onto `services::ops`. A `broker`
    /// reference reappearing in one of these means a write path grew a
    /// fan-out outside the orchestration layer again.
    const MIGRATED: &[&str] = &[
        "src/handlers/library.rs",
        "src/handlers/volume.rs",
        "src/handlers/locations.rs",
    ];

    #[test]
    fn migrated_handlers_do_not_reach_for_the_broker() {
        for rel in MIGRATED {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(rel);
            let Ok(src) = std::fs::read_to_string(&path) else {
                continue;
            };
            for (idx, line) in src.lines().enumerate() {
                assert!(
                    !line.contains("broker"),
                    "{rel}:{} reaches for the broker directly.\n  {}\n\
                     Write paths with more than one caller belong in \
                     `services::ops`, so a second caller cannot forget the \
                     realtime fan-out and leave every open device stale.",
                    idx + 1,
                    line.trim()
                );
            }
        }
    }

    /// The list above is only worth anything if the files exist — a
    /// rename would otherwise turn the guard into a no-op that still
    /// passes.
    #[test]
    fn migrated_handlers_all_exist() {
        for rel in MIGRATED {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(rel);
            assert!(
                path.is_file(),
                "{rel} is listed as migrated onto `services::ops` but does \
                 not exist — fix the path or drop the entry, otherwise the \
                 broker guard silently checks nothing."
            );
        }
    }
}
