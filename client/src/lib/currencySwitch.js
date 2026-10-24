import { db } from "@/lib/db.js";

/*
 * 銭 · What switching the display currency would touch.
 *
 * It touches nothing: prices are stored without a currency and the
 * switch only changes how they are written. But a reader who has saved
 * `12.50` as dollars and sees `€12,50` (or `¥13`) tomorrow deserves to
 * be told first that the number is the same, not converted. So before a
 * switch the page asks this device's synced copy of the library whether
 * any price above zero exists, and if so shows one real example.
 */

const positive = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * How many saved prices are above zero, and the first of them (for the
 * example). Volumes and boxsets both carry a price. `database` is a
 * parameter so a test can hand in a stand-in.
 */
export async function countSavedPrices(database = db) {
  let count = 0;
  let example = null;
  for (const table of [database.volumes, database.coffrets]) {
    if (!table) continue;
    await table.each((row) => {
      const amount = positive(row?.price);
      if (amount > 0) {
        count += 1;
        if (example === null) example = amount;
      }
    });
  }
  return { count, example };
}

/**
 * Decide what a click on a currency button should do.
 *   { action: "none" }                     the same currency again
 *   { action: "apply" }                    no saved price: just switch
 *   { action: "confirm", count, example }  ask first
 */
export async function planCurrencySwitch({ current, next, counter = countSavedPrices }) {
  if (!next || current === next) return { action: "none" };
  const { count, example } = await counter();
  if (count === 0) return { action: "apply" };
  return { action: "confirm", count, example };
}
