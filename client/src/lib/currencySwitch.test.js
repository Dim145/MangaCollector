import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queryClient.js", () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    removeQueries: vi.fn(),
  },
}));

const { db } = await import("./db.js");
const { countSavedPrices, planCurrencySwitch } = await import("./currencySwitch.js");

/*
 * Switching the display currency converts nothing, so the only thing
 * worth asking before it is "will any number you saved read differently?"
 * — and only prices above zero can. A library full of 0 and null prices
 * switches without a question.
 */

const vol = (id, price) => ({ id, mal_id: 1, vol_num: id, owned: true, price });

beforeEach(async () => {
  await db.volumes.clear();
  await db.coffrets.clear();
});

describe("countSavedPrices", () => {
  it("is zero for a library with no price", async () => {
    await db.volumes.bulkPut([vol(1, null), vol(2, undefined), vol(3, "0"), vol(4, "0.00"), vol(5, 0)]);
    expect(await countSavedPrices()).toEqual({ count: 0, example: null });
  });

  it("counts the prices above zero, as the API writes them (strings) or numbers", async () => {
    await db.volumes.bulkPut([vol(1, "12.50"), vol(2, 1200), vol(3, "0.00"), vol(4, null), vol(5, "-3")]);
    const { count, example } = await countSavedPrices();
    expect(count).toBe(2);
    expect(example).toBe(12.5);
  });

  it("counts a boxset's price too", async () => {
    await db.coffrets.bulkPut([{ id: 9, mal_id: 1, price: "49.90" }]);
    expect(await countSavedPrices()).toEqual({ count: 1, example: 49.9 });
  });

  it("ignores junk instead of throwing", async () => {
    await db.volumes.bulkPut([vol(1, "abc"), vol(2, NaN), vol(3, {})]);
    expect((await countSavedPrices()).count).toBe(0);
  });
});

describe("planCurrencySwitch", () => {
  const counter = (count, example = null) => vi.fn(async () => ({ count, example }));

  it("does nothing for the currency already in use, without even counting", async () => {
    const c = counter(5, 1);
    expect(await planCurrencySwitch({ current: "USD", next: "USD", counter: c })).toEqual({ action: "none" });
    expect(c).not.toHaveBeenCalled();
  });

  it("does nothing without a target", async () => {
    expect(await planCurrencySwitch({ current: "USD", next: undefined, counter: counter(1, 1) })).toEqual({ action: "none" });
  });

  it("switches straight away when no price above zero exists", async () => {
    expect(await planCurrencySwitch({ current: "USD", next: "JPY", counter: counter(0) })).toEqual({ action: "apply" });
  });

  it("asks first when prices exist, and carries the count and an example", async () => {
    expect(await planCurrencySwitch({ current: "USD", next: "JPY", counter: counter(3, 12.5) })).toEqual({
      action: "confirm",
      count: 3,
      example: 12.5,
    });
  });

  it("asks for any pair of currencies, in both directions", async () => {
    for (const [a, b] of [["USD", "EUR"], ["EUR", "JPY"], ["JPY", "USD"]]) {
      expect((await planCurrencySwitch({ current: a, next: b, counter: counter(1, 7) })).action).toBe("confirm");
    }
  });

  it("works against the real local cache", async () => {
    await db.volumes.bulkPut([vol(1, "12.50")]);
    expect(await planCurrencySwitch({ current: "USD", next: "JPY" })).toMatchObject({ action: "confirm", count: 1 });
    await db.volumes.clear();
    expect(await planCurrencySwitch({ current: "USD", next: "JPY" })).toEqual({ action: "apply" });
  });
});
