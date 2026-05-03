//! 活動 · Activity log coalescing buffer.
//!
//! The activity feed is a journal of "things you did with your
//! collection" — `series_added`, `volume_owned`, etc. Without a
//! buffer, every transient toggle lands in the feed: a user who
//! mis-clicks a volume and undoes it within a second pollutes the
//! page with a noise pair (owned / unowned for the same row).
//!
//! This module debounces a small set of *toggleable* events:
//!
//!   • `volume_owned`  ↔ `volume_unowned`   keyed on (user_id, mal_id, vol_num)
//!   • `series_added`  ↔ `series_removed`   keyed on (user_id, mal_id)
//!
//! Each `record(...)` call enters a short delay window (default
//! 5 s). If the *opposite* event for the same key arrives during
//! the window, the buffered entry is dropped AND the new event is
//! discarded — both sides cancelled, the feed sees nothing. If
//! nothing compensates, the entry flushes to the DB at delay
//! expiry, with its **original** timestamp preserved (so streak
//! computation and per-day grouping remain accurate).
//!
//! Other event types (milestones, `series_completed`, etc.) are
//! NOT routed here — they're terminal-state events that don't
//! invert.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use tokio::sync::Mutex;

use crate::db::Db;
use crate::models::activity::event_types;
use crate::services::activity;

/// Default coalescing window. Long enough to absorb an "oops"
/// undo, short enough that the feed feels responsive.
pub const DEFAULT_DELAY: Duration = Duration::from_secs(5);

#[derive(Hash, Eq, PartialEq, Clone, Debug)]
struct BufferKey {
    user_id: i32,
    class: EventClass,
    mal_id: Option<i32>,
    vol_num: Option<i32>,
}

#[derive(Hash, Eq, PartialEq, Copy, Clone, Debug)]
enum EventClass {
    Volume,
    Series,
}

#[derive(Clone, Debug)]
struct Pending {
    event_type: String,
    name: Option<String>,
    count_value: Option<i32>,
    /// Captured at `record` call time. Used both as the eventual
    /// `created_on` of the DB row AND as the discriminator that
    /// lets the flush task tell its own scheduled entry apart
    /// from a later same-direction event that overwrote it.
    created_on: DateTime<Utc>,
}

/// Returns `Some((class, compensating_event_type))` when `event_type`
/// participates in a compensating pair; `None` otherwise.
fn classify(event_type: &str) -> Option<(EventClass, &'static str)> {
    match event_type {
        e if e == event_types::VOLUME_OWNED => Some((EventClass::Volume, event_types::VOLUME_UNOWNED)),
        e if e == event_types::VOLUME_UNOWNED => Some((EventClass::Volume, event_types::VOLUME_OWNED)),
        e if e == event_types::SERIES_ADDED => Some((EventClass::Series, event_types::SERIES_REMOVED)),
        e if e == event_types::SERIES_REMOVED => Some((EventClass::Series, event_types::SERIES_ADDED)),
        _ => None,
    }
}

#[derive(Clone)]
pub struct ActivityCoalescer {
    pending: Arc<Mutex<HashMap<BufferKey, Pending>>>,
    delay: Duration,
    db: Db,
}

impl ActivityCoalescer {
    pub fn new(db: Db, delay: Duration) -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            delay,
            db,
        }
    }

    /// Schedule an event for flushing after the coalescing window.
    ///
    /// • If the event isn't a known toggle (see `classify`), it
    ///   flushes immediately — the buffer never holds non-toggle
    ///   events.
    /// • If a compensating event for the same key is already
    ///   buffered, both are cancelled.
    /// • Otherwise the event replaces any same-direction entry at
    ///   the same key (keep the latest payload — typically a
    ///   refreshed series name) and a flush task is spawned.
    pub async fn record(
        &self,
        user_id: i32,
        event_type: &str,
        mal_id: Option<i32>,
        vol_num: Option<i32>,
        name: Option<String>,
        count_value: Option<i32>,
    ) {
        let Some((class, compensator)) = classify(event_type) else {
            // Non-toggleable — flush immediately.
            activity::record(
                &self.db,
                user_id,
                event_type,
                mal_id,
                vol_num,
                name,
                count_value,
            )
            .await;
            return;
        };

        let key = BufferKey {
            user_id,
            class,
            mal_id,
            vol_num,
        };
        let now = Utc::now();

        {
            let mut map = self.pending.lock().await;

            // Compensation check: if the inverse event is buffered,
            // drop it AND discard the new one. The two cancel out.
            if let Some(existing) = map.get(&key)
                && existing.event_type == compensator
            {
                map.remove(&key);
                tracing::debug!(
                    user_id,
                    event_type,
                    compensator = compensator,
                    "activity: compensating pair, both events dropped"
                );
                return;
            }

            // Same-direction or fresh — insert. `created_on`
            // doubles as the spawn-time discriminator below.
            map.insert(
                key.clone(),
                Pending {
                    event_type: event_type.to_string(),
                    name,
                    count_value,
                    created_on: now,
                },
            );
        }

        // Spawn a flush task. The task wakes after `delay`, checks
        // the map, and only writes if the entry it scheduled is
        // still there with the same `created_on` (cheap stamp-
        // based generation check — protects against the entry
        // being overwritten by a later same-direction event).
        let pending = Arc::clone(&self.pending);
        let delay = self.delay;
        let db = self.db.clone();
        let scheduled_at = now;
        let key_for_task = key;
        tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            let to_flush = {
                let mut map = pending.lock().await;
                match map.get(&key_for_task) {
                    Some(entry) if entry.created_on == scheduled_at => {
                        map.remove(&key_for_task)
                    }
                    _ => None,
                }
            };
            if let Some(entry) = to_flush {
                activity::record_at(
                    &db,
                    key_for_task.user_id,
                    &entry.event_type,
                    key_for_task.mal_id,
                    key_for_task.vol_num,
                    entry.name,
                    entry.count_value,
                    entry.created_on,
                )
                .await;
            }
        });
    }

    /// Snapshot of the current pending-entry count. Useful for
    /// observability or smoke-testing the buffer in operator
    /// shells; not load-bearing for any production codepath.
    pub async fn pending_count(&self) -> usize {
        self.pending.lock().await.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_known_pairs() {
        assert_eq!(
            classify(event_types::VOLUME_OWNED),
            Some((EventClass::Volume, event_types::VOLUME_UNOWNED))
        );
        assert_eq!(
            classify(event_types::SERIES_ADDED),
            Some((EventClass::Series, event_types::SERIES_REMOVED))
        );
    }

    #[test]
    fn classify_unknown_returns_none() {
        assert_eq!(classify(event_types::SERIES_COMPLETED), None);
        assert_eq!(classify(event_types::MILESTONE_VOLUMES), None);
    }
}
