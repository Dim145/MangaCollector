//! 試 · `set_physical_details` against a real Postgres.
//!
//! The question these answer is not "does it compile" but "after a
//! write, what does a *reader* see": every test writes through the
//! service, reads the row back through `get_all_for_user_by_mal_id` (the
//! call behind the MCP tool `get_volumes`), serialises it the way the
//! tool does, and compares it whole with the row as it was before. A
//! field that changed without being asked to is a failure.
//!
//! They need a throwaway database and skip, loudly, without one:
//!
//! ```text
//! docker run -d --rm --name mc-pg-test -e POSTGRES_PASSWORD=t -e POSTGRES_DB=t -p 127.0.0.1:54330:5432 postgres:15-alpine
//! TEST_DATABASE_URL=postgres://postgres:t@127.0.0.1:54330/t cargo test physical_db
//! ```
//!
//! Each test makes its own user, so they can share one database and run
//! in parallel; every user is deleted at the end (rows cascade). Never
//! point `TEST_DATABASE_URL` at a database you care about: the
//! migrations are applied to it.

use std::sync::atomic::{AtomicU32, Ordering};

use sea_orm::{ConnectionTrait, DbBackend, Statement};
use serde_json::Value;

use super::{get_all_for_user_by_mal_id, set_physical_details};
use crate::db::{Db, create_db, create_pool, run_migrations};
use crate::models::volume::PhysicalPatch;

static SEQ: AtomicU32 = AtomicU32::new(0);

struct Fixture {
    db: Db,
    user_id: i32,
    mal_id: i32,
    volume_id: i32,
}

impl Fixture {
    /// `None` (and a message) when no test database is configured.
    async fn new() -> Option<Self> {
        let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
            eprintln!("physical_db: TEST_DATABASE_URL not set — skipped");
            return None;
        };
        let pool = create_pool(&url)
            .await
            .expect("connect to TEST_DATABASE_URL");
        run_migrations(&pool)
            .await
            .expect("migrate the test database");
        let db = create_db(pool);
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let tag = format!("{}-{n}", uuid::Uuid::new_v4());
        let mal_id = 700_000 + (n as i32);
        let user_id = scalar(
            &db,
            &format!(
                "INSERT INTO users (created_on, modified_on, name, email, google_id) \
                 VALUES (now(), now(), 'physical-db-test', '{tag}@example.invalid', '{tag}') RETURNING id"
            ),
        )
        .await;
        // Every column a reader can see is set to a value that is not the
        // column default, so "left alone" cannot be mistaken for "reset".
        let volume_id = scalar(
            &db,
            &format!(
                "INSERT INTO user_volumes \
                   (created_on, modified_on, user_id, mal_id, vol_num, owned, price, store, collector, notes, \
                    condition, location, extra_copies, bought_at, isbn, has_obi, has_jacket, has_slipcase, wanted) \
                 VALUES (now(), now(), {user_id}, {mal_id}, 3, true, 7.00, 'Old Store', true, 'a note', \
                    'good', 'shelf A', 2, '2020-01-02', '9784063805185', true, true, true, true) RETURNING id"
            ),
        )
        .await;
        Some(Self {
            db,
            user_id,
            mal_id,
            volume_id,
        })
    }

    async fn row(&self) -> Value {
        let rows = get_all_for_user_by_mal_id(&self.db, self.user_id, self.mal_id)
            .await
            .expect("read the volumes back");
        let mut v = serde_json::to_value(&rows).expect("serialise as the tool does");
        let row = v.as_array_mut().and_then(|a| a.pop()).expect("one volume");
        let obj = row.as_object().cloned().expect("a JSON object");
        // The only two columns that move on every write by design.
        let mut obj = obj;
        obj.remove("modified_on");
        obj.remove("sync_rev");
        Value::Object(obj)
    }

    async fn patch(&self, patch: PhysicalPatch) {
        set_physical_details(&self.db, self.volume_id, self.user_id, patch)
            .await
            .expect("the patch applies");
    }

    async fn cleanup(self) {
        let _ = self
            .db
            .execute(Statement::from_string(
                DbBackend::Postgres,
                format!("DELETE FROM users WHERE id = {}", self.user_id),
            ))
            .await;
    }
}

async fn scalar(db: &Db, sql: &str) -> i32 {
    let row = db
        .query_one(Statement::from_string(DbBackend::Postgres, sql.to_string()))
        .await
        .expect("query")
        .expect("a row came back");
    row.try_get::<i32>("", "id").expect("an id")
}

/// The keys whose value differs between two row snapshots.
fn changed(before: &Value, after: &Value) -> Vec<String> {
    let (b, a) = (before.as_object().unwrap(), after.as_object().unwrap());
    let mut keys: Vec<String> = b
        .keys()
        .chain(a.keys())
        .filter(|k| b.get(*k) != a.get(*k))
        .cloned()
        .collect();
    keys.sort();
    keys.dedup();
    keys
}

fn money(text: &str) -> Option<Option<rust_decimal::Decimal>> {
    use std::str::FromStr;
    Some(Some(rust_decimal::Decimal::from_str(text).unwrap()))
}

#[tokio::test]
async fn the_seed_row_reads_back_as_written() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    let row = f.row().await;
    assert_eq!(row["price"], "7.00");
    assert_eq!(row["store"], "Old Store");
    assert_eq!(row["condition"], "good");
    assert_eq!(row["extra_copies"], 2);
    assert_eq!(row["isbn"], "9784063805185");
    f.cleanup().await;
}

#[tokio::test]
async fn a_price_alone_changes_only_the_price() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    let before = f.row().await;
    f.patch(PhysicalPatch {
        price: money("1200"),
        ..Default::default()
    })
    .await;
    let after = f.row().await;
    assert_eq!(changed(&before, &after), ["price"]);
    assert_eq!(
        after["price"], "1200.00",
        "stored as DECIMAL(12,2), read back with its scale"
    );
    f.cleanup().await;
}

#[tokio::test]
async fn a_store_alone_changes_only_the_store() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    let before = f.row().await;
    f.patch(PhysicalPatch {
        store: Some(Some("CDJapan".into())),
        ..Default::default()
    })
    .await;
    let after = f.row().await;
    assert_eq!(changed(&before, &after), ["store"]);
    assert_eq!(after["store"], "CDJapan");
    f.cleanup().await;
}

#[tokio::test]
async fn price_and_store_together_change_exactly_those_two() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    let before = f.row().await;
    f.patch(PhysicalPatch {
        price: money("5414"),
        store: Some(Some("Mandarake".into())),
        ..Default::default()
    })
    .await;
    let after = f.row().await;
    assert_eq!(changed(&before, &after), ["price", "store"]);
    assert_eq!(
        (after["price"].as_str(), after["store"].as_str()),
        (Some("5414.00"), Some("Mandarake"))
    );
    f.cleanup().await;
}

#[tokio::test]
async fn omitting_price_and_store_keeps_them_through_every_other_physical_write() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    let before = f.row().await;
    let others: Vec<(&str, PhysicalPatch)> = vec![
        (
            "condition",
            PhysicalPatch {
                condition: Some(Some("poor".into())),
                ..Default::default()
            },
        ),
        (
            "location",
            PhysicalPatch {
                location: Some(Some("shelf B".into())),
                ..Default::default()
            },
        ),
        (
            "extra_copies",
            PhysicalPatch {
                extra_copies: Some(5),
                ..Default::default()
            },
        ),
        (
            "bought_at",
            PhysicalPatch {
                bought_at: Some(Some(chrono::NaiveDate::from_ymd_opt(2025, 1, 15).unwrap())),
                ..Default::default()
            },
        ),
        (
            "isbn",
            PhysicalPatch {
                isbn: Some(Some("9784065361863".into())),
                ..Default::default()
            },
        ),
        (
            "has_obi",
            PhysicalPatch {
                has_obi: Some(false),
                ..Default::default()
            },
        ),
        (
            "has_jacket",
            PhysicalPatch {
                has_jacket: Some(false),
                ..Default::default()
            },
        ),
        (
            "has_slipcase",
            PhysicalPatch {
                has_slipcase: Some(false),
                ..Default::default()
            },
        ),
    ];
    let mut expect_changed: Vec<String> = Vec::new();
    for (name, patch) in others {
        f.patch(patch).await;
        expect_changed.push(name.to_string());
        let now = f.row().await;
        assert_eq!(
            now["price"], before["price"],
            "price moved after writing {name}"
        );
        assert_eq!(
            now["store"], before["store"],
            "store moved after writing {name}"
        );
    }
    // And the writes themselves landed, each on its own column and no other.
    let after = f.row().await;
    let mut moved = changed(&before, &after);
    moved.sort();
    expect_changed.sort();
    assert_eq!(moved, expect_changed);
    // The untouched rest of the row: ownership, collector flag, notes, wanted.
    for key in ["owned", "collector", "notes", "wanted", "vol_num", "mal_id"] {
        assert_eq!(after[key], before[key], "{key} moved");
    }
    f.cleanup().await;
}

#[tokio::test]
async fn an_empty_value_clears_price_or_store_and_nothing_else() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    let before = f.row().await;
    f.patch(PhysicalPatch {
        price: Some(None),
        ..Default::default()
    })
    .await;
    let mid = f.row().await;
    assert_eq!(changed(&before, &mid), ["price"]);
    assert!(mid["price"].is_null());
    f.patch(PhysicalPatch {
        store: Some(None),
        ..Default::default()
    })
    .await;
    let after = f.row().await;
    assert_eq!(changed(&mid, &after), ["store"]);
    assert!(after["store"].is_null());
    assert_eq!(after["condition"], before["condition"]);
    f.cleanup().await;
}

#[tokio::test]
async fn a_zero_price_is_a_price_and_is_not_confused_with_clearing() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    f.patch(PhysicalPatch {
        price: money("0"),
        ..Default::default()
    })
    .await;
    let row = f.row().await;
    // Postgres hands a zero back without its scale ("0"); what matters is
    // that it is a number, equal to zero, and not NULL.
    let zero: rust_decimal::Decimal = row["price"]
        .as_str()
        .expect("a price, not null")
        .parse()
        .unwrap();
    assert!(zero.is_zero());
    f.cleanup().await;
}

#[tokio::test]
async fn the_largest_price_the_column_holds_round_trips() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    f.patch(PhysicalPatch {
        price: money("9999999999.99"),
        ..Default::default()
    })
    .await;
    assert_eq!(f.row().await["price"], "9999999999.99");
    f.cleanup().await;
}

#[tokio::test]
async fn a_store_is_trimmed_clamped_and_a_blank_one_clears() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    f.patch(PhysicalPatch {
        store: Some(Some("  Mandarake  ".into())),
        ..Default::default()
    })
    .await;
    assert_eq!(f.row().await["store"], "Mandarake");
    f.patch(PhysicalPatch {
        store: Some(Some("x".repeat(200))),
        ..Default::default()
    })
    .await;
    assert_eq!(
        f.row().await["store"].as_str().unwrap().chars().count(),
        crate::models::coffret::STORE_MAX_LEN
    );
    f.patch(PhysicalPatch {
        store: Some(Some("   ".into())),
        ..Default::default()
    })
    .await;
    assert!(f.row().await["store"].is_null());
    f.cleanup().await;
}

#[tokio::test]
async fn writing_the_same_patch_twice_changes_nothing_the_second_time() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    let patch = || PhysicalPatch {
        price: money("320"),
        store: Some(Some("CDJapan".into())),
        ..Default::default()
    };
    f.patch(patch()).await;
    let once = f.row().await;
    f.patch(patch()).await;
    assert_eq!(changed(&once, &f.row().await), Vec::<String>::new());
    f.cleanup().await;
}

#[tokio::test]
async fn another_users_volume_is_not_touched() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    let before = f.row().await;
    // A different user id: the (id, user_id) gate makes this a silent no-op.
    set_physical_details(
        &f.db,
        f.volume_id,
        f.user_id + 1_000_000,
        PhysicalPatch {
            price: money("1"),
            store: Some(Some("intruder".into())),
            ..Default::default()
        },
    )
    .await
    .expect("a foreign id is a silent Ok");
    assert_eq!(changed(&before, &f.row().await), Vec::<String>::new());
    f.cleanup().await;
}

#[tokio::test]
async fn an_empty_patch_writes_nothing() {
    let Some(f) = Fixture::new().await else {
        return;
    };
    let before = f.row().await;
    f.patch(PhysicalPatch::default()).await;
    assert_eq!(changed(&before, &f.row().await), Vec::<String>::new());
    f.cleanup().await;
}
