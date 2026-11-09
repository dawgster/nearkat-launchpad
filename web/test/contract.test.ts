import { describe, expect, test } from "vitest";
import {
  KatContract,
  LOAN_STORAGE_DEPOSIT,
  pickRentable,
  returnValue,
} from "../src/lib/contract.ts";

const outcome = (value: unknown) => ({
  // The chain returns the method's JSON as base64 of its UTF-8 bytes.
  status: { SuccessValue: Buffer.from(JSON.stringify(value), "utf8").toString("base64") },
  transaction: {},
});

describe("returnValue", () => {
  test("decodes what the contract method returned", () => {
    expect(returnValue(outcome({ token_id: "7", owner_id: "alice.near" }))).toEqual({
      token_id: "7",
      owner_id: "alice.near",
    });
  });

  test("decodes non-ASCII text", () => {
    expect(returnValue(outcome({ title: "Pal — №1 🐾" }))).toEqual({ title: "Pal — №1 🐾" });
  });

  test.each([
    ["a method that returns nothing", { status: { SuccessValue: "" } }],
    ["a failed transaction", { status: { Failure: {} } }],
    ["a value that is not JSON", { status: { SuccessValue: btoa("not json") } }],
    ["an outcome of an unexpected shape", { ok: true }],
    ["nothing at all", undefined],
  ])("gives null for %s", (_name, value) => {
    expect(returnValue(value)).toBeNull();
  });
});

describe("pickRentable", () => {
  const offer = (tokenId: string, lender: string, fee: number, apps = ["app-a"]) => ({
    tokenId,
    lender,
    fee: BigInt(fee),
    apps,
  });
  const offers = [
    offer("1", "alice.near", 5),
    offer("2", "alice.near", 1),
    offer("3", "alice.near", 9),
    offer("4", "bob.near", 2),
    offer("5", "bob.near", 8),
    offer("6", "bob.near", 3),
    offer("7", "carol.near", 4),
    offer("8", "carol.near", 7),
    offer("9", "carol.near", 6),
  ];

  test("spreads across lenders, cheapest first", () => {
    const picked = pickRentable(offers, "app-a", 4);
    expect(picked).toHaveLength(4);
    // Every lender is paid, and each lender's cheapest offer comes before its dearer ones.
    expect(new Set(picked.map((id) => offers.find((o) => o.tokenId === id)?.lender)).size).toBe(3);
    expect([...picked].sort()).toEqual(["2", "4", "6", "7"]);
  });

  test("skips offers for other apps and never exceeds what is offered", () => {
    const mixed = [offer("1", "a.near", 1, ["other"]), offer("2", "b.near", 2)];
    expect(pickRentable(mixed, "app-a", 5)).toEqual(["2"]);
  });
});

describe("chunked transactions", () => {
  const tokens = Array.from({ length: 120 }, (_, i) => String(i + 1));
  const recorder = () => {
    const calls: Array<{ method: string; args: { token_ids: string[] }; deposit: string }> = [];
    const near = {
      call: async (
        _id: string,
        method: string,
        args: { token_ids: string[] },
        options: { attachedDeposit: string },
      ) => {
        calls.push({ method, args, deposit: options.attachedDeposit });
        return {};
      },
    };
    return { calls, contract: new KatContract(near as never, "set.near") };
  };

  test("lendMany splits 120 samples into 50/50/20 with matching storage deposits", async () => {
    const { calls, contract } = recorder();
    const listed = await contract.lendMany(tokens, { durationS: null, fee: 1n, apps: ["a"] });
    expect(listed).toBe(120);
    expect(calls.map((c) => c.args.token_ids.length)).toEqual([50, 50, 20]);
    expect(calls.map((c) => c.deposit)).toEqual(
      [50n, 50n, 20n].map((n) => `${LOAN_STORAGE_DEPOSIT * n} yocto`),
    );
  });

  test("borrowMany attaches each chunk's own fees", async () => {
    const { calls, contract } = recorder();
    const feeOf = (id: string) => BigInt(Number(id) * 7 + 3);
    await contract.borrowMany(tokens, "a", feeOf);
    expect(calls.map((c) => c.args.token_ids.length)).toEqual([50, 50, 20]);
    for (const call of calls) {
      const sum = call.args.token_ids.reduce((acc, id) => acc + feeOf(id), 0n);
      expect(call.deposit).toBe(`${sum} yocto`);
    }
  });
});

describe("rentalsOf", () => {
  test("finds the account's unspent rentals, grouped by training app", async () => {
    const tokens = ["1", "2", "3", "4", "5", "6"].map((id) => ({
      token_id: id,
      owner_id: "lender",
    }));
    const loans: Record<string, object> = {
      "1": { status: "active", borrower_id: "me.near" },
      "2": { status: "active", borrower_id: "me.near" },
      "3": { status: "active", borrower_id: "me.near" }, // spent
      "4": { status: "active", borrower_id: "other.near" },
      "5": { status: "offered", borrower_id: null },
      "6": { status: "active", borrower_id: "me.near" },
    };
    const training: Record<string, object> = {
      "1": { apps: ["a", "b"], app_id: "a", spent: false },
      "2": { apps: ["a"], app_id: "a", spent: false },
      "3": { apps: ["a"], app_id: "a", spent: true },
      "4": { apps: ["a"], app_id: "a", spent: false },
      "5": { apps: ["a"], app_id: null, spent: false },
      "6": { apps: ["b"], app_id: "b", spent: false },
    };
    const near = {
      view: async (
        _id: string,
        method: string,
        args: { token_id?: string; from_index?: string },
      ) => {
        if (method === "nft_tokens") {
          return args.from_index === "0" ? tokens : [];
        }
        if (method === "get_loan") {
          return loans[args.token_id as string] ?? null;
        }
        if (method === "get_loan_training") {
          return training[args.token_id as string] ?? null;
        }
        throw new Error(method);
      },
    };
    const contract = new KatContract(near as never, "set.near");
    expect(await contract.rentalsOf("me.near")).toEqual([
      { appId: "a", tokenIds: ["1", "2"] },
      { appId: "b", tokenIds: ["6"] },
    ]);
  });
});
