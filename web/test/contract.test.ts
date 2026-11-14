import { describe, expect, test } from "vitest";
import {
  isModelToken,
  KatContract,
  LOAN_STORAGE_DEPOSIT,
  type ModelView,
  modelTokenOf,
  PartialBatchError,
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

describe("pickRentable for a renter", () => {
  test("never picks the renter's own samples", () => {
    const offers = [
      { tokenId: "1", lender: "me.near", fee: 1n, apps: ["a"] },
      { tokenId: "2", lender: "bob.near", fee: 5n, apps: ["a"] },
    ];
    expect(pickRentable(offers, "a", 2, "me.near")).toEqual(["2"]);
    expect(pickRentable(offers, "a", 2).sort()).toEqual(["1", "2"]);
  });
});

describe("batched transactions", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
  type Action = {
    method: string;
    args: { token_ids: string[] };
    gas: string;
    deposit: string;
  };
  const recorder = () => {
    const transactions: Array<{ signer: string; receiver: string; actions: Action[] }> = [];
    const near = {
      transaction(signer: string) {
        const tx = { signer, receiver: "", actions: [] as Action[] };
        const builder = {
          functionCall(
            receiver: string,
            method: string,
            args: { token_ids: string[] },
            options: { gas: string; attachedDeposit: string },
          ) {
            tx.receiver = receiver;
            tx.actions.push({ method, args, gas: options.gas, deposit: options.attachedDeposit });
            return builder;
          },
          async send(_options: { waitUntil: string }) {
            transactions.push(tx);
            return {};
          },
        };
        return builder;
      },
    };
    return { transactions, contract: new KatContract(near as never, "set.near") };
  };
  const tgas = (gas: string) => Number(gas.replace(" Tgas", ""));

  test("rents 150 samples in one transaction: three borrow_many actions of 50", async () => {
    const { transactions, contract } = recorder();
    const feeOf = (id: string) => BigInt(Number(id) * 7 + 3);
    const rented = await contract.borrowMany("me.near", ids(150), "a", feeOf);
    expect(rented).toBe(150);
    expect(transactions).toHaveLength(1);
    const [tx] = transactions;
    expect(tx?.signer).toBe("me.near");
    expect(tx?.receiver).toBe("set.near");
    expect(tx?.actions.map((a) => a.method)).toEqual(Array(3).fill("borrow_many"));
    expect(tx?.actions.map((a) => a.args.token_ids.length)).toEqual([50, 50, 50]);
    for (const action of tx?.actions ?? []) {
      const sum = action.args.token_ids.reduce((acc, id) => acc + feeOf(id), 0n);
      expect(action.deposit).toBe(`${sum} yocto`);
      expect(action).toMatchObject({ args: { app_id: "a" } });
    }
    // The gas of all its actions fits what one transaction may attach.
    expect(tx?.actions.reduce((sum, a) => sum + tgas(a.gas), 0)).toBeLessThanOrEqual(300);
  });

  test("past three batches, a second transaction carries the rest", async () => {
    const { transactions, contract } = recorder();
    await contract.borrowMany("me.near", ids(200), "a", () => 1n);
    expect(transactions.map((tx) => tx.actions.map((a) => a.args.token_ids.length))).toEqual([
      [50, 50, 50],
      [50],
    ]);
  });

  test("lists 120 samples in one transaction, each action with its own storage", async () => {
    const { transactions, contract } = recorder();
    const listed = await contract.lendMany("me.near", ids(120), {
      durationS: null,
      fee: 1n,
      apps: ["a"],
    });
    expect(listed).toBe(120);
    expect(transactions).toHaveLength(1);
    const actions = transactions[0]?.actions ?? [];
    expect(actions.map((a) => a.method)).toEqual(Array(3).fill("lend_many"));
    expect(actions.map((a) => a.args.token_ids.length)).toEqual([50, 50, 20]);
    expect(actions.map((a) => a.deposit)).toEqual(
      [50n, 50n, 20n].map((n) => `${LOAN_STORAGE_DEPOSIT * n} yocto`),
    );
    expect(actions.reduce((sum, a) => sum + tgas(a.gas), 0)).toBeLessThanOrEqual(300);
  });

  test("a failure after the first transaction says how many went through", async () => {
    let sent = 0;
    const near = {
      transaction: () => {
        const builder = {
          functionCall: () => builder,
          send: async () => {
            if (++sent === 2) {
              throw new Error("out of gas");
            }
            return {};
          },
        };
        return builder;
      },
    };
    const contract = new KatContract(near as never, "set.near");
    const error = await contract.borrowMany("me.near", ids(200), "a", () => 1n).catch((e) => e);
    expect(error).toBeInstanceOf(PartialBatchError);
    expect(error.done).toBe(150);
    expect(error.message).toBe("out of gas");
    // Nothing went through before the first failure, so it is reported as it is.
    sent = 1;
    const first = await contract.borrowMany("me.near", ids(10), "a", () => 1n).catch((e) => e);
    expect(first).toBeInstanceOf(Error);
    expect(first).not.toBeInstanceOf(PartialBatchError);
  });

  test("withdraws 25 offers: end_loan with a yoctoNEAR each, ten to a transaction", async () => {
    const { transactions, contract } = recorder();
    const withdrawn = await contract.endLoans("me.near", ids(25));
    expect(withdrawn).toBe(25);
    expect(transactions.map((tx) => tx.actions.length)).toEqual([10, 10, 5]);
    const actions = transactions.flatMap((tx) => tx.actions);
    expect(actions.map((a) => a.method)).toEqual(Array(25).fill("end_loan"));
    expect(actions.map((a) => (a.args as unknown as { token_id: string }).token_id)).toEqual(
      ids(25),
    );
    expect(actions.every((a) => a.deposit === "1 yocto")).toBe(true);
    for (const tx of transactions) {
      expect(tx.actions.reduce((sum, a) => sum + tgas(a.gas), 0)).toBeLessThanOrEqual(300);
    }
  });

  test("a rental with no fee still attaches a yoctoNEAR", async () => {
    const { transactions, contract } = recorder();
    await contract.borrowMany("me.near", ids(2), "a", () => 0n);
    expect(transactions[0]?.actions[0]?.deposit).toBe("1 yocto");
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

describe("katsOf", () => {
  test.each([
    [250, ["0", "100", "200"]],
    [200, ["0", "100"]],
    [0, []],
  ])("reads every page of an owner's %i tokens, never past the end", async (n, froms) => {
    const owned = Array.from({ length: n }, (_, i) => ({ token_id: String(i + 1) }));
    const calls: Array<{ from_index: string; limit: number }> = [];
    const near = {
      view: async (_id: string, method: string, args: { from_index: string; limit: number }) => {
        if (method === "nft_supply_for_owner") {
          return String(owned.length);
        }
        if (method !== "nft_tokens_for_owner") {
          throw new Error(method);
        }
        calls.push(args);
        const from = Number(args.from_index);
        // As near-contract-standards does.
        if (from >= owned.length) {
          throw new Error("Out of bounds, please use a smaller from_index.");
        }
        return owned.slice(from, from + args.limit);
      },
    };
    const ids = await new KatContract(near as never, "set.near").katsOf("creator.near");
    expect(ids).toEqual(owned.map((t) => t.token_id));
    expect(calls.map((c) => c.from_index)).toEqual(froms);
  });
});

describe("models", () => {
  const model = (n: number): ModelView => ({
    token_id: `model-run-${n}`,
    run_id: `run-${n}`,
    owner_id: "renter.near",
    app_id: "app-a",
    renter_id: "renter.near",
    model_sha256: "ab".repeat(32),
    accuracy_bps: 9000,
    token_count: 150,
    sealed_hash: "c2VhbGVk",
    sealed_ref: `fastfs:trainer.near:${"a".repeat(64)}:${"1".repeat(44)}`,
    recorded_at: "1700000000000000000",
  });

  test("a model's token is named after its run, and told apart from samples by its id", () => {
    expect(modelTokenOf("run-0a1b2c3d4e5f")).toBe("model-run-0a1b2c3d4e5f");
    expect(isModelToken("model-run-0a1b2c3d4e5f")).toBe(true);
    expect(isModelToken("17")).toBe(false);
  });

  test("reads one model, and null for a sample", async () => {
    const calls: Array<[string, object]> = [];
    const near = {
      view: async (_id: string, method: string, args: { token_id: string }) => {
        calls.push([method, args]);
        return args.token_id === "model-run-1" ? model(1) : null;
      },
    };
    const contract = new KatContract(near as never, "set.near");
    expect(await contract.getModel("model-run-1")).toEqual(model(1));
    expect(await contract.getModel("7")).toBeNull();
    expect(calls[0]).toEqual(["get_model", { token_id: "model-run-1" }]);
  });

  test.each([
    [0, [0]],
    [3, [0]],
    [100, [0, 100]],
    [250, [0, 100, 200]],
  ])("reads all %i models, a page of 100 at a time", async (n, froms) => {
    const all = Array.from({ length: n }, (_, i) => model(i));
    const calls: Array<{ from: number; limit: number }> = [];
    const near = {
      view: async (_id: string, method: string, args: { from: number; limit: number }) => {
        if (method !== "get_models") {
          throw new Error(method);
        }
        calls.push(args);
        return all.slice(args.from, args.from + args.limit);
      },
    };
    expect(await new KatContract(near as never, "set.near").getModels()).toEqual(all);
    expect(calls.map((call) => call.from)).toEqual(froms);
    expect(calls.every((call) => call.limit === 100)).toBe(true);
  });

  test("a collection whose code predates models has none", async () => {
    const near = {
      view: async () => {
        throw new Error("MethodResolveError(MethodNotFound)");
      },
    };
    const contract = new KatContract(near as never, "old.near");
    expect(await contract.getModels()).toEqual([]);
    expect(await contract.getModel("model-run-1")).toBeNull();
  });

  test("any other failure reading models is passed on", async () => {
    const near = {
      view: async () => {
        throw new Error("Too many requests");
      },
    };
    const contract = new KatContract(near as never, "set.near");
    await expect(contract.getModels()).rejects.toThrow("Too many requests");
    await expect(contract.getModel("model-run-1")).rejects.toThrow("Too many requests");
  });

  // An owner's tokens as the standard returns them: by id as text, so models come last.
  const ownerNear = (ids: string[]) => ({
    view: async (_id: string, method: string, args: { from_index: string; limit: number }) => {
      if (method === "nft_supply_for_owner") {
        return String(ids.length);
      }
      if (method !== "nft_tokens_for_owner") {
        throw new Error(method);
      }
      const from = Number(args.from_index);
      return ids.slice(from, from + args.limit).map((token_id) => ({ token_id }));
    },
  });

  test("an owner's tokens: samples by number, then the models they hold", async () => {
    const contract = new KatContract(
      ownerNear(["10", "2", "model-run-b", "33", "model-run-a"]) as never,
      "set.near",
    );
    expect(await contract.katsOf("me.near")).toEqual([
      "2",
      "10",
      "33",
      "model-run-a",
      "model-run-b",
    ]);
  });

  test("an owner's samples leave out the models they hold", async () => {
    const contract = new KatContract(
      ownerNear(["10", "2", "model-run-b", "33"]) as never,
      "set.near",
    );
    expect(await contract.samplesOf("me.near")).toEqual(["2", "10", "33"]);
  });

  test("offers and rentals never read a model token's loan", async () => {
    const asked: string[] = [];
    const near = {
      view: async (
        _id: string,
        method: string,
        args: { token_id?: string; from_index?: string },
      ) => {
        if (method === "nft_tokens") {
          return args.from_index === "0"
            ? [
                { token_id: "1", owner_id: "lender.near" },
                { token_id: "model-run-1", owner_id: "me.near" },
              ]
            : [];
        }
        asked.push(`${method}:${args.token_id}`);
        if (method === "get_loan") {
          return { status: "offered", lender_id: "lender.near", borrower_id: null, fee: "5" };
        }
        if (method === "get_loan_training") {
          return { apps: ["a"], app_id: null, spent: false };
        }
        throw new Error(method);
      },
    };
    const contract = new KatContract(near as never, "set.near");
    expect(await contract.sampleOffers()).toEqual([
      { tokenId: "1", fee: 5n, lender: "lender.near", apps: ["a"] },
    ]);
    expect(await contract.rentalsOf("me.near")).toEqual([]);
    expect(asked.some((call) => call.includes("model-"))).toBe(false);
  });
});
