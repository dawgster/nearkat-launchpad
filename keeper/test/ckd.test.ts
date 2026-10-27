import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  appId,
  CONTEXT_KEY_PATH,
  contextRoot,
  fetchContextRoot,
  MpcKeyring,
  newAppKey,
  openResponse,
} from "../src/ckd.ts";
import { FakeChain, KEY_SOURCE } from "./fakes.ts";

/** A response from the mock MPC contract's Rust implementation of the network's maths. */
const vector = JSON.parse(
  readFileSync(join(process.cwd(), "test/fixtures/ckd-vector.json"), "utf8"),
) as Record<string, string>;
const secret = BigInt(vector.app_secret as string);
const response = { big_y: vector.big_y as string, big_c: vector.big_c as string };
const app = appId(vector.caller as string, vector.path as string);

describe("CKD", () => {
  test("opens and checks a response made by the Rust implementation", () => {
    const key = openResponse(response, secret, vector.mpc_public_key as string, app);
    expect(key).toHaveLength(48);
    expect(contextRoot(key)).toHaveLength(32);
  });

  test("refuses a response for another collection", () => {
    const other = appId("someone-else.near", vector.path as string);
    expect(() => openResponse(response, secret, vector.mpc_public_key as string, other)).toThrow(
      /not a valid key/,
    );
  });

  test("refuses a response opened with the wrong secret", () => {
    expect(() => openResponse(response, secret + 1n, vector.mpc_public_key as string, app)).toThrow(
      /not a valid key/,
    );
  });

  test("refuses a response checked against another network key", () => {
    const { publicKey } = newAppKey();
    expect(() => openResponse(response, secret, publicKey, app)).toThrow();
  });

  test("derives the app id the network does", () => {
    // sha3_256 over the prefixed caller and path, as near/mpc's derive_app_id.
    expect(Buffer.from(appId("a.near", "p")).toString("hex")).toHaveLength(64);
    expect(appId("a.near", "p")).not.toEqual(appId("b.near", "p"));
  });

  test("makes a fresh throwaway key for every request", () => {
    expect(newAppKey().publicKey).not.toBe(newAppKey().publicKey);
    expect(newAppKey().publicKey).toMatch(/^bls12381g1:/);
  });

  test("refuses an answer that isn't for this request's throwaway key", async () => {
    // Replays the vector's answer to a request made with a different key.
    const chain = {
      getKeyEpoch: async () => 1,
      requestContextKey: async () => response,
      mpcPublicKey: async () => vector.mpc_public_key as string,
    };
    await expect(
      fetchContextRoot(vector.caller as string, { mpc_contract_id: "mpc", domain_id: 2 }, chain, 1),
    ).rejects.toThrow(/not a valid key/);
    expect(CONTEXT_KEY_PATH).toBe(vector.path);
  });
});

describe("MpcKeyring", () => {
  test("gives the same keys to every keeper of a collection, and different keys per epoch", async () => {
    const chain = new FakeChain();
    chain.rotate();
    const a = new MpcKeyring(chain.contractId, KEY_SOURCE, chain);
    const b = new MpcKeyring(chain.contractId, KEY_SOURCE, chain);
    expect(await a.currentEpoch()).toBe(2);
    expect(await a.katKey("1", 2)).toEqual(await b.katKey("1", 2));
    expect(await a.katKey("1", 1)).not.toEqual(await a.katKey("1", 2));
    expect(await a.katKey("1", 2)).not.toEqual(await a.katKey("2", 2));
  });

  test("gives another collection's tokens other keys", async () => {
    const chain = new FakeChain();
    const other = new FakeChain();
    other.contractId = "other.near";
    const a = new MpcKeyring(chain.contractId, KEY_SOURCE, chain);
    const b = new MpcKeyring(other.contractId, KEY_SOURCE, other);
    expect(await a.katKey("1", 1)).not.toEqual(await b.katKey("1", 1));
  });

  test("asks the network once per epoch, and again after a failure", async () => {
    const chain = new FakeChain();
    const keyring = new MpcKeyring(chain.contractId, KEY_SOURCE, chain);
    chain.ckdFailure = "MPC timed out";
    await expect(keyring.katKey("1", 1)).rejects.toThrow(/MPC timed out/);
    chain.ckdFailure = null;
    await keyring.katKey("1", 1);
    await keyring.katKey("2", 1);
    expect(chain.ckdRequests).toBe(2);
  });

  test("notices a new epoch only when told to", async () => {
    const chain = new FakeChain();
    const keyring = new MpcKeyring(chain.contractId, KEY_SOURCE, chain);
    expect(await keyring.currentEpoch()).toBe(1);
    chain.rotate();
    expect(await keyring.currentEpoch()).toBe(1);
    keyring.refresh();
    expect(await keyring.currentEpoch()).toBe(2);
  });

  test("has no key for epoch 0 or one that doesn't exist yet", async () => {
    const chain = new FakeChain();
    const keyring = new MpcKeyring(chain.contractId, KEY_SOURCE, chain);
    await expect(keyring.katKey("1", 0)).rejects.toThrow(/epoch 0/);
    await expect(keyring.katKey("1", 2)).rejects.toThrow(/key_epoch must be 1 to 1/);
  });
});
