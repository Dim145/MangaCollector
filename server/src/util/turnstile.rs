//! 並 · One at a time per account, a few at a time per instance.
//!
//! Some work holds something scarce for its whole length — a pool
//! connection and a transaction (an archive import), or a stream of
//! calls to somebody else's API that will ban the instance's address if
//! it grows (an import by username). Any identity at the provider can
//! sign in, so "a user would not do that" is not a limit: this is.
//!
//! A `Turn` is given back when it is dropped — on success, on error and
//! on a panic alike.

use std::collections::HashSet;
use std::sync::{Mutex, PoisonError};

use crate::errors::AppError;

pub struct Turnstile {
    running: Mutex<HashSet<i32>>,
    max: usize,
    /// What is being queued, for the refusal: "import", "external import".
    what: &'static str,
}

impl Turnstile {
    pub fn new(max: usize, what: &'static str) -> Self {
        Self {
            running: Mutex::new(HashSet::new()),
            max,
            what,
        }
    }

    /// Take a place for `user_id`, or say why there is none.
    pub fn enter(&'static self, user_id: i32) -> Result<Turn, AppError> {
        let mut running = self.running.lock().unwrap_or_else(PoisonError::into_inner);
        if running.contains(&user_id) {
            return Err(AppError::Conflict(format!(
                "An {} is already running for this account.",
                self.what
            )));
        }
        if running.len() >= self.max {
            return Err(AppError::Conflict(format!(
                "Another {} is running on this instance. Try again in a minute.",
                self.what
            )));
        }
        running.insert(user_id);
        Ok(Turn {
            gate: self,
            user_id,
        })
    }
}

pub struct Turn {
    gate: &'static Turnstile,
    user_id: i32,
}

impl Drop for Turn {
    fn drop(&mut self) {
        self.gate
            .running
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&self.user_id);
    }
}

#[cfg(test)]
mod tests {
    use super::Turnstile;
    use crate::errors::AppError;
    use std::sync::LazyLock;

    static GATE: LazyLock<Turnstile> = LazyLock::new(|| Turnstile::new(2, "import"));

    #[test]
    fn one_per_account_and_a_few_per_instance() {
        let first = GATE.enter(1).expect("free");
        assert!(matches!(GATE.enter(1), Err(AppError::Conflict(_))));
        let second = GATE.enter(2).expect("a second account");
        assert!(matches!(GATE.enter(3), Err(AppError::Conflict(_))));
        drop(first);
        // The place comes back when the turn is dropped.
        let third = GATE.enter(3).expect("freed");
        drop((second, third));
        assert!(GATE.enter(1).is_ok());
    }
}
