import { describe, expect, test } from "vitest";
import { collectionPrices } from "../src/collection.ts";

const keeper = { chat: 2_000n, save: 50_000n };
const terms = (over: Partial<Parameters<typeof collectionPrices>[0] & object> = {}) => ({
  royalty_bps: 0,
  creator_share_bps: 0,
  chat_price: null,
  save_price: null,
  ...over,
});

describe("collectionPrices", () => {
  test("charges the keeper's own prices by default", () => {
    expect(collectionPrices(undefined, keeper)).toEqual({ ...keeper, shortfall: null });
    expect(collectionPrices(terms(), keeper)).toEqual({ ...keeper, shortfall: null });
  });

  test("raises unset prices just enough to cover the creator's share", () => {
    const prices = collectionPrices(terms({ creator_share_bps: 2_000 }), keeper);
    expect(prices).toEqual({ chat: 2_500n, save: 62_500n, shortfall: null });
  });

  test("uses the collection's own prices when they cover the keeper", () => {
    const prices = collectionPrices(
      terms({ creator_share_bps: 5_000, chat_price: "4000", save_price: "100000" }),
      keeper,
    );
    expect(prices).toEqual({ chat: 4_000n, save: 100_000n, shortfall: null });
  });

  test("says when the collection's prices leave the keeper short", () => {
    const prices = collectionPrices(
      terms({ creator_share_bps: 5_000, chat_price: "3000" }),
      keeper,
    );
    expect(prices.shortfall).toMatch(/below this keeper's own/);
  });
});
