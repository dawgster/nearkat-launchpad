import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { fetchSampleKeys } from "../src/ckd.ts";
import { HttpError } from "../src/errors.ts";
import { Ingest } from "../src/ingest.ts";
import { keysFromRootSecret } from "../src/keys.ts";
import { openSample, SAMPLE_INFO } from "../src/samples.ts";
import { INFO, sealTo } from "../src/sealing.ts";
import { type ContextStore, MemoryStore } from "../src/store.ts";
import { FAKE_COLLECTION, FakeChain, KEY_SOURCE } from "./fakes.ts";

const keys = keysFromRootSecret(Buffer.alloc(32, 9));
const sealing = keys.sealing();
const JPEG = Buffer.from([0xff, 0xd8, 1, 2, 3, 4]).toString("base64");

const sealed = (label: string, jpeg = JPEG, info = SAMPLE_INFO) =>
  sealTo(sealing.publicKeyHex, JSON.stringify({ label, jpeg }), info);

class CountingMinter extends FakeChain {
  override async finishMinting(): Promise<void> {
    await super.finishMinting();
    this.collection = {
      ...this.collection,
      minted: Math.min((this.collection.minted ?? 0) + 2, this.collection.max_supply ?? 0),
    };
    for (let i = 1; i <= (this.collection.minted ?? 0); i++) {
      if (!this.samples.has(String(i))) {
        this.samples.set(String(i), {
          owner_id: "admin.near",
          sample_hash: null,
          sample_ref: null,
          runs: 0,
        });
      }
    }
  }
}

function setup(
  minted = 3,
  chain: FakeChain = new FakeChain(),
  store: ContextStore = new MemoryStore(),
) {
  chain.collection = {
    ...FAKE_COLLECTION,
    kind: { Dataset: { classes: ["cat", "dog"] } },
    minted,
    max_supply: 3,
  };
  for (let i = 1; i <= minted; i++) {
    chain.samples.set(String(i), {
      owner_id: "admin.near",
      sample_hash: null,
      sample_ref: null,
      runs: 0,
    });
  }
  const ingest = new Ingest({
    contractId: chain.contractId,
    chain,
    store,
    sealing,
    mpcPublicKey: () => chain.mpcPublicKey(KEY_SOURCE),
  });
  return { chain, store, ingest };
}

describe("Ingest", () => {
  test("seals each sample under its own key and records it", async () => {
    const { chain, store, ingest } = setup();
    const result = await ingest.seal("admin.near", [
      { token_id: "1", sealed: sealed("cat") },
      { token_id: "2", sealed: sealed("dog") },
    ]);
    expect(result).toEqual({ sealed: ["1", "2"], skipped: [] });
    const one = chain.samples.get("1");
    expect(one?.sample_ref).toBeTruthy();
    const blob = await store.get(one?.sample_ref as string);
    expect(createHash("sha256").update(blob).digest("base64")).toBe(one?.sample_hash);
    const mpc = await chain.mpcPublicKey(KEY_SOURCE);
    const keyMap = await fetchSampleKeys(
      chain.contractId,
      (ids, app) => chain.requestSampleKeys(ids, app),
      mpc,
      ["1"],
    );
    const doc = openSample(keyMap.get("1") as Buffer, blob, "1");
    expect(doc).toMatchObject({ token_id: "1", label: "cat", jpeg: JPEG });
  });

  test("skips tokens that already have a sample", async () => {
    const { chain, ingest } = setup();
    chain.samples.set("1", { owner_id: "admin.near", sample_hash: "x", sample_ref: "r", runs: 0 });
    const result = await ingest.seal("admin.near", [
      { token_id: "1", sealed: sealed("cat") },
      { token_id: "2", sealed: sealed("dog") },
    ]);
    expect(result).toEqual({ sealed: ["2"], skipped: ["1"] });
    expect(chain.samples.get("1")?.sample_ref).toBe("r");
  });

  test("only the collection's creator can ingest", async () => {
    const { ingest } = setup();
    await expect(
      ingest.seal("mallory.near", [{ token_id: "1", sealed: sealed("cat") }]),
    ).rejects.toMatchObject({
      status: 403,
    });
  });

  test("refuses a label that isn't one of the classes", async () => {
    const { ingest } = setup();
    const error = await ingest
      .seal("admin.near", [{ token_id: "2", sealed: sealed("bird") }])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
    expect((error as HttpError).message).toBe(
      "Sample 2 has a label that is not one of the classes",
    );
    expect((error as HttpError).message).not.toContain(JPEG);
  });

  test("refuses something sealed for another purpose", async () => {
    const { ingest } = setup();
    await expect(
      ingest.seal("admin.near", [{ token_id: "1", sealed: sealed("cat", JPEG, INFO) }]),
    ).rejects.toMatchObject({ status: 400 });
  });

  const jpegOf = (bytes: number) => {
    const b = Buffer.alloc(bytes, 7);
    b[0] = 0xff;
    b[1] = 0xd8;
    return b.toString("base64");
  };

  test("accepts a sample at the 96 KB limit", async () => {
    const { ingest } = setup();
    const result = await ingest.seal("admin.near", [
      { token_id: "1", sealed: sealed("cat", jpegOf(96 * 1024)) },
    ]);
    expect(result.sealed).toEqual(["1"]);
  });

  test("refuses a JPEG over 96 KB", async () => {
    const { ingest } = setup();
    const jpeg = jpegOf(96 * 1024 + 1);
    const error = await ingest
      .seal("admin.near", [{ token_id: "2", sealed: sealed("cat", jpeg) }])
      .catch((e: unknown) => e);
    expect((error as HttpError).status).toBe(400);
    expect((error as HttpError).message).toBe("Sample 2's picture is over 96 KB");
    expect((error as HttpError).message).not.toContain(jpeg.slice(0, 40));
  });

  test("refuses a picture that isn't a JPEG", async () => {
    const { ingest } = setup();
    await expect(
      ingest.seal("admin.near", [
        { token_id: "1", sealed: sealed("cat", Buffer.from("GIF89a").toString("base64")) },
      ]),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("refuses a token that doesn't exist, and more than 25 samples", async () => {
    const { ingest } = setup();
    await expect(
      ingest.seal("admin.near", [{ token_id: "9", sealed: sealed("cat") }]),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("9") });
    const many = Array.from({ length: 26 }, (_, i) => ({ token_id: String(i + 1), sealed: "x" }));
    await expect(ingest.seal("admin.near", many)).rejects.toMatchObject({ status: 400 });
  });

  test("refuses a collection that isn't a dataset", async () => {
    const { chain, ingest } = setup();
    chain.collection = { ...chain.collection, kind: "Character" };
    await expect(
      ingest.seal("admin.near", [{ token_id: "1", sealed: sealed("cat") }]),
    ).rejects.toMatchObject({ status: 409 });
  });

  test("finishes minting before sealing", async () => {
    const { chain, ingest } = setup(0, new CountingMinter());
    const result = await ingest.seal("admin.near", [{ token_id: "1", sealed: sealed("cat") }]);
    expect(result.sealed).toEqual(["1"]);
    expect((chain as CountingMinter).finishMintingCalls).toBe(2);
  });

  test("gives up if minting never finishes", async () => {
    const { chain, ingest } = setup(0);
    await expect(
      ingest.seal("admin.near", [{ token_id: "1", sealed: sealed("cat") }]),
    ).rejects.toThrow(/Minting did not finish/);
    expect(chain.finishMintingCalls).toBe(25);
  });

  test("stores in chunks of 20 when the store can", async () => {
    const batches: number[] = [];
    const store = Object.assign(new MemoryStore(), {
      async putMany(blobs: Uint8Array[]) {
        batches.push(blobs.length);
        return Promise.all(blobs.map((b) => new MemoryStore().put(b)));
      },
    });
    const chain = new FakeChain();
    const { ingest } = setup(25, chain, store);
    chain.collection = { ...chain.collection, max_supply: 25 };
    const items = Array.from({ length: 25 }, (_, i) => ({
      token_id: String(i + 1),
      sealed: sealed("cat"),
    }));
    await ingest.seal("admin.near", items);
    expect(batches).toEqual([20, 5]);
  });
});
