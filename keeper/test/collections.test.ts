import { describe, expect, test } from "vitest";
import type { KeyProof } from "../src/chain.ts";
import { Collections } from "../src/collections.ts";
import { KatService } from "../src/kats.ts";
import { keysFromRootSecret } from "../src/keys.ts";
import { Meter } from "../src/meter.ts";
import { sealTo } from "../src/sealing.ts";
import { MemoryStore } from "../src/store.ts";
import { FAKE_COLLECTION, FakeChain, FakeInference, KEY_SOURCE, NEAR } from "./fakes.ts";

const keys = keysFromRootSecret(Buffer.alloc(32, 7));
const APP = "0a1b2c";
const PROOF: KeyProof = {
  public_key: keys.nearPublicKey(),
  seal_public_key: keys.sealing().publicKeyHex,
  quote: "beef",
  collateral: "{}",
  event_log: "[]",
};

function setup(
  runningAs: { mode: "local" } | { mode: "phala"; appId: string } = { mode: "local" },
  shared: { chains?: Map<string, FakeChain>; store?: MemoryStore } = {},
) {
  const chains = shared.chains ?? new Map<string, FakeChain>();
  const chainFor = (id: string) => {
    let chain = chains.get(id);
    if (!chain) {
      chain = new FakeChain();
      chain.contractId = id;
      chains.set(id, chain);
    }
    return chain;
  };
  const logs: string[] = [];
  const store = shared.store ?? new MemoryStore();
  const inference = new FakeInference();
  const collections = new Collections({
    keeperAccountId: "keeper.near",
    keeperPublicKey: keys.nearPublicKey(),
    runningAs,
    chainFor,
    keeperPrices: { chat: 10n, save: 100n },
    sealing: keys.sealing(),
    build: (_contractId, chain, info, prices, keyring) => {
      const meter = new Meter(chain);
      const kats = new KatService({
        chain,
        store,
        keyring,
        inference,
        meter,
        prices,
        collection: info,
        retryDelayMs: 0,
      });
      return { meter, kats };
    },
    proof: runningAs.mode === "phala" ? async () => PROOF : undefined,
    log: (message) => logs.push(message),
  });
  return { collections, chainFor, logs, inference, chains, store };
}

describe("Collections", () => {
  test("serves collections that name this keeper, each with its own prompt", async () => {
    const { collections, chainFor, inference } = setup();
    chainFor("tutor.near").collection = {
      ...FAKE_COLLECTION,
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
    expect(a?.personality).toBe(FAKE_COLLECTION.starter);
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
      ...FAKE_COLLECTION,
      tee: { Phala: { app_id: APP } },
    };
    expect(await collections.add("private.near")).toBe(false);
    expect(collections.waiting()[0]?.reason).toMatch(/refused: .*local mode/);
  });

  test("registers its attested key with a TEE collection before serving it", async () => {
    const { collections, chainFor } = setup({ mode: "phala", appId: APP });
    const chain = chainFor("private.near");
    chain.collection = { ...FAKE_COLLECTION, tee: { Phala: { app_id: APP } } };
    expect(await collections.add("private.near")).toBe(true);
    expect(chain.proofs).toEqual([PROOF]);
  });

  test("doesn't register again when the contract already accepts its key", async () => {
    const { collections, chainFor } = setup({ mode: "phala", appId: APP });
    const chain = chainFor("private.near");
    chain.collection = { ...FAKE_COLLECTION, tee: { Phala: { app_id: APP } } };
    chain.attested.add(keys.nearPublicKey());
    expect(await collections.add("private.near")).toBe(true);
    expect(chain.proofs).toHaveLength(0);
  });

  test("waits when the contract refuses its attestation", async () => {
    const { collections, chainFor } = setup({ mode: "phala", appId: APP });
    const chain = chainFor("private.near");
    chain.collection = { ...FAKE_COLLECTION, tee: { Phala: { app_id: APP } } };
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

describe("Collections, terms and sealed prompts", () => {
  test("serves a collection at its own prices, and lists them", async () => {
    const { collections, chainFor } = setup();
    chainFor("tutor.near").collection = {
      ...FAKE_COLLECTION,
      terms: { royalty_bps: 0, creator_share_bps: 0, chat_price: "20", save_price: null },
    };
    expect(await collections.add("tutor.near")).toBe(true);
    expect(collections.get("tutor.near")?.prices).toEqual({ chat: 20n, save: 100n });
  });

  test("waits on a collection whose prices don't cover the keeper", async () => {
    const { collections, chainFor } = setup();
    chainFor("cheap.near").collection = {
      ...FAKE_COLLECTION,
      terms: { royalty_bps: 0, creator_share_bps: 0, chat_price: "1", save_price: null },
    };
    expect(await collections.add("cheap.near")).toBe(false);
    expect(collections.waiting()[0]?.reason).toMatch(/below this keeper's own/);
  });

  test("opens a prompt sealed to its own key", async () => {
    const { collections, chainFor } = setup({ mode: "phala", appId: APP });
    const chain = chainFor("oracle.near");
    chain.collection = {
      ...FAKE_COLLECTION,
      tee: { Phala: { app_id: APP } },
      sealed_prompt: {
        ciphertext: sealTo(keys.sealing().publicKeyHex, "The answer is LANTERN."),
        sealed_to: keys.sealing().publicKeyHex,
      },
    };
    expect(await collections.add("oracle.near")).toBe(true);
    expect(collections.get("oracle.near")?.info.secret_prompt).toBe("The answer is LANTERN.");
  });

  test("waits on a prompt sealed to another keeper", async () => {
    const { collections, chainFor } = setup({ mode: "phala", appId: APP });
    chainFor("oracle.near").collection = {
      ...FAKE_COLLECTION,
      tee: { Phala: { app_id: APP } },
      sealed_prompt: { ciphertext: "AAAA", sealed_to: "ab".repeat(32) },
    };
    expect(await collections.add("oracle.near")).toBe(false);
    expect(collections.waiting()[0]?.reason).toMatch(/sealed to another keeper's key/);
  });
});

describe("Collections, context keys from NEAR's MPC network", () => {
  test("any keeper the collection names can open its contexts, without sharing a secret", async () => {
    const first = setup();
    expect(await first.collections.add("lantern.near")).toBe(true);
    expect(first.chainFor("lantern.near").ckdRequests).toBe(1);
    first.chainFor("lantern.near").mint("1", "alice.near", NEAR);
    await first.collections.get("lantern.near")?.kats.wakeNew();

    // Another keeper process, reading the same chain and storage. It shares no secret with the first.
    const other = setup({ mode: "local" }, { chains: first.chains, store: first.store });
    expect(await other.collections.add("lantern.near")).toBe(true);
    const context = await other.collections.get("lantern.near")?.kats.getContext("alice.near", "1");
    expect(context?.personality).toBe(FAKE_COLLECTION.starter);
  });

  test("after a rotation, reads the old key's contexts and saves under the new key", async () => {
    const { collections, chainFor, inference } = setup();
    const chain = chainFor("lantern.near");
    await collections.add("lantern.near");
    chain.mint("1", "alice.near", NEAR);
    const kats = collections.get("lantern.near")?.kats;
    await kats?.wakeNew();
    expect(chain.kats.get("1")?.key_epoch).toBe(1);

    chain.rotate();
    inference.evolveTo = { character: "You are rotated.", memory: "" };
    for (let i = 0; i < 10; i++) {
      await kats?.chat("alice.near", "1", `hello ${i}`);
    }
    expect(chain.kats.get("1")?.key_epoch).toBe(2);
    expect((await kats?.getContext("alice.near", "1"))?.personality).toBe("You are rotated.");
  });

  test("stops serving a collection that names another keeper", async () => {
    const { collections, chainFor } = setup();
    await collections.add("lantern.near");
    chainFor("lantern.near").keeperId = "other-keeper.near";
    await collections.recheck();
    expect(collections.get("lantern.near")).toBeUndefined();
    expect(collections.waiting()[0]?.reason).toMatch(/now names other-keeper.near/);
  });

  test("waits on a collection whose contract has no key source", async () => {
    const { collections, chainFor } = setup();
    const { key_source: _, ...old } = FAKE_COLLECTION;
    chainFor("old.near").collection = old as typeof FAKE_COLLECTION;
    expect(await collections.add("old.near")).toBe(false);
    expect(collections.waiting()[0]?.reason).toMatch(/no key source/);
  });

  test("waits, and retries later, when the MPC network doesn't answer", async () => {
    const { collections, chainFor } = setup();
    const chain = chainFor("lantern.near");
    chain.ckdFailure = "MPC timed out";
    expect(await collections.add("lantern.near")).toBe(false);
    expect(collections.waiting()[0]?.reason).toMatch(
      /could not get its context key from v1.signer/,
    );
    chain.ckdFailure = null;
    expect(await collections.add("lantern.near")).toBe(true);
  });

  test("refuses a key that isn't the network's", async () => {
    const { collections, chainFor } = setup();
    const chain = chainFor("lantern.near");
    // The answer comes from a different master secret than the published key.
    const published = await chain.mpcPublicKey(KEY_SOURCE);
    chain.mpcSecret += 1n;
    chain.mpcPublicKey = async () => published;
    expect(await collections.add("lantern.near")).toBe(false);
    expect(collections.waiting()[0]?.reason).toMatch(/not a valid key/);
  });

  test("asks a TEE collection for its key only after registering its attested key", async () => {
    const { collections, chainFor } = setup({ mode: "phala", appId: APP });
    const chain = chainFor("vault.near");
    chain.collection = { ...FAKE_COLLECTION, tee: { Phala: { app_id: APP } } };
    let attestedWhenAsked = false;
    const request = chain.requestContextKey.bind(chain);
    chain.requestContextKey = async (key, epoch) => {
      attestedWhenAsked = chain.attested.has(PROOF.public_key);
      return request(key, epoch);
    };
    expect(await collections.add("vault.near")).toBe(true);
    expect(attestedWhenAsked).toBe(true);
  });
});
