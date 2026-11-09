import { describe, expect, test } from "vitest";
import { KatContract } from "../src/lib/contract.ts";
import { ViewCache } from "../src/lib/viewCache.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ViewCache", () => {
  test("runs at most 8 loads at once", async () => {
    const views = new ViewCache(8);
    let running = 0;
    let most = 0;
    const load = async () => {
      running += 1;
      most = Math.max(most, running);
      await tick();
      running -= 1;
      return 1;
    };
    await Promise.all(Array.from({ length: 50 }, (_, i) => views.run(`k${i}`, load, false)));
    expect(most).toBe(8);
  });

  test("loads a cached key once until cleared, and never keeps a failure", async () => {
    const views = new ViewCache(8);
    let loads = 0;
    const load = async () => ++loads;
    expect(await Promise.all([views.run("a", load, true), views.run("a", load, true)])).toEqual([
      1, 1,
    ]);
    expect(await views.run("a", load, true)).toBe(1);
    expect(await views.run("b", load, false)).toBe(2);
    expect(await views.run("b", load, false)).toBe(3);
    views.clear();
    expect(await views.run("a", load, true)).toBe(4);
    await expect(views.run("c", () => Promise.reject(new Error("rpc")), true)).rejects.toThrow();
    expect(await views.run("c", load, true)).toBe(5);
  });
});

describe("a collection page's reader", () => {
  test("scans for offers and rentals at once with one read per token's loan", async () => {
    const tokens = Array.from({ length: 60 }, (_, i) => ({
      token_id: String(i + 1),
      owner_id: "lender.near",
    }));
    const calls = new Map<string, number>();
    let running = 0;
    let most = 0;
    const near = {
      view: async (_id: string, method: string, args: { token_id?: string }) => {
        const key = `${method}:${args.token_id ?? ""}`;
        calls.set(key, (calls.get(key) ?? 0) + 1);
        running += 1;
        most = Math.max(most, running);
        await tick();
        running -= 1;
        if (method === "nft_tokens") {
          return tokens;
        }
        if (method === "get_loan") {
          return { status: "offered", lender_id: "lender.near", fee: "1" };
        }
        if (method === "get_loan_training") {
          return { apps: ["a"], app_id: null, spent: false };
        }
        return null;
      },
    };
    const reader = new KatContract(near as never, "set.near", { views: new ViewCache(8) });
    const [offers, rentals] = await Promise.all([
      reader.sampleOffers(),
      reader.rentalsOf("me.near"),
    ]);
    expect(offers).toHaveLength(60);
    expect(rentals).toEqual([]);
    expect(most).toBeLessThanOrEqual(8);
    expect(calls.get("nft_tokens:")).toBe(1);
    for (const token of tokens) {
      expect(calls.get(`get_loan:${token.token_id}`)).toBe(1);
    }
    // A reload after a transaction reads afresh.
    reader.forget();
    await reader.sampleOffers();
    expect(calls.get("get_loan:1")).toBe(2);
  });
});
