import { describe, expect, test } from "vitest";
import type { KeyProof } from "../src/chain.ts";
import { DEFAULT_COLLECTION } from "../src/collection.ts";
import { Collections } from "../src/collections.ts";
import { KatService } from "../src/kats.ts";
import { keysFromRootSecret } from "../src/keys.ts";
import { Meter } from "../src/meter.ts";
import { MemoryStore } from "../src/store.ts";
import { FakeChain, FakeInference, NEAR } from "./fakes.ts";

const keys = keysFromRootSecret(Buffer.alloc(32, 7));
const APP = "0a1b2c";
const PROOF: KeyProof = {
  public_key: keys.nearPublicKey(),
  quote: "beef",
  collateral: "{}",
  event_log: "[]",
};

function setup(
  runningAs: { mode: "local" } | { mode: "phala"; appId: string } = { mode: "local" },
) {
  const chains = new Map<string, FakeChain>();
  const chainFor = (id: string) => {
    let chain = chains.get(id);
    if (!chain) {
      chain = new FakeChain();
      chains.set(id, chain);
    }
    return chain;
  };
  const logs: string[] = [];
  const store = new MemoryStore();
  const inference = new FakeInference();
  const collections = new Collections({
    keeperAccountId: "keeper.near",
    keeperPublicKey: keys.nearPublicKey(),
    runningAs,
    chainFor,
    build: (contractId, chain, info) => {
      const meter = new Meter(chain);
      const kats = new KatService({
        chain,
        store,
        keys: keys.forContract(contractId),
        inference,
        meter,
        prices: { chat: 1n, save: 1n },
        collection: info,
        retryDelayMs: 0,
      });
      return { meter, kats };
    },
    proof: runningAs.mode === "phala" ? async () => PROOF : undefined,
    log: (message) => logs.push(message),
  });
  return { collections, chainFor, logs, inference };
}

describe("Collections", () => {
  test("serves collections that name this keeper, each with its own prompt", async () => {
    const { collections, chainFor, inference } = setup();
    chainFor("tutor.near").collection = {
      ...DEFAULT_COLLECTION,
      name: "Magister",
      prompt: "You are {name} #{token_id}, a tutor.",
      starter: "No student yet.",
    };
    expect(await collections.add("nearkat.near")).toBe(true);
    expect(await collections.add("tutor.near")).toBe(true);

    const tutor = chainFor("tutor.near");
    tutor.mint("1", "alice.near", NEAR);
    const served = collections.get("tutor.near");
    await served?.kats.wakeNew();
    await served?.kats.chat("alice.near", "1", "salve");
    expect(inference.calls[0]?.[0]?.content).toContain("You are Magister #1, a tutor.");
    expect(collections.all().map((c) => c.contractId)).toEqual(["nearkat.near", "tutor.near"]);
  });

  test("keeps the same token number in two collections apart", async () => {
    const { collections, chainFor } = setup();
    await collections.add("a.near");
    await collections.add("b.near");
    for (const id of ["a.near", "b.near"]) {
      chainFor(id).mint("1", "alice.near", NEAR);
      await collections.get(id)?.kats.wakeNew();
    }
    // Each token 1 has its own context, under its own contract's key.
    expect(chainFor("a.near").kats.get("1")?.context_hash).not.toBe(
      chainFor("b.near").kats.get("1")?.context_hash,
    );
    const a = await collections.get("a.near")?.kats.getContext("alice.near", "1");
    expect(a?.personality).toBe(DEFAULT_COLLECTION.starter);
  });

  test("waits on a collection that names another keeper, and picks it up once it switches", async () => {
    const { collections, chainFor, logs } = setup();
    chainFor("other.near").keeperId = "someone-else.near";
    expect(await collections.add("other.near")).toBe(false);
    expect(collections.waiting()).toEqual([
      { contractId: "other.near", reason: "it names someone-else.near as its keeper" },
    ]);
    // Logged once, not on every retry.
    await collections.add("other.near");
    expect(logs.filter((l) => l.includes("someone-else"))).toHaveLength(1);

    chainFor("other.near").keeperId = "keeper.near";
    expect(await collections.add("other.near")).toBe(true);
    expect(collections.waiting()).toEqual([]);
  });

  test("refuses a TEE collection from a local keeper", async () => {
    const { collections, chainFor } = setup();
    chainFor("private.near").collection = {
      ...DEFAULT_COLLECTION,
      tee: { Phala: { app_id: APP } },
    };
    expect(await collections.add("private.near")).toBe(false);
    expect(collections.waiting()[0]?.reason).toMatch(/refused: .*local mode/);
  });

  test("registers its attested key with a TEE collection before serving it", async () => {
    const { collections, chainFor } = setup({ mode: "phala", appId: APP });
    const chain = chainFor("private.near");
    chain.collection = { ...DEFAULT_COLLECTION, tee: { Phala: { app_id: APP } } };
    expect(await collections.add("private.near")).toBe(true);
    expect(chain.proofs).toEqual([PROOF]);
  });

  test("doesn't register again when the contract already accepts its key", async () => {
    const { collections, chainFor } = setup({ mode: "phala", appId: APP });
    const chain = chainFor("private.near");
    chain.collection = { ...DEFAULT_COLLECTION, tee: { Phala: { app_id: APP } } };
    chain.attested.add(keys.nearPublicKey());
    expect(await collections.add("private.near")).toBe(true);
    expect(chain.proofs).toHaveLength(0);
  });

  test("waits when the contract refuses its attestation", async () => {
    const { collections, chainFor } = setup({ mode: "phala", appId: APP });
    const chain = chainFor("private.near");
    chain.collection = { ...DEFAULT_COLLECTION, tee: { Phala: { app_id: APP } } };
    chain.registerKeeperKey = async () => {
      throw new Error("the quote's report data does not commit to this key");
    };
    expect(await collections.add("private.near")).toBe(false);
    expect(collections.waiting()[0]?.reason).toMatch(/did not accept this keeper's attestation/);
  });

  test("withdraws earnings once they reach the minimum", async () => {
    const { collections, chainFor } = setup();
    await collections.add("a.near");
    await collections.add("b.near");
    chainFor("a.near").inferenceAccrued = 5n;
    chainFor("b.near").inferenceAccrued = 1n;
    await collections.withdrawEarnings(2n);
    expect(chainFor("a.near").withdrawals).toBe(1);
    expect(chainFor("b.near").withdrawals).toBe(0);
  });
});
