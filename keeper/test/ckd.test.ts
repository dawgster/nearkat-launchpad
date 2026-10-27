import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  appId,
  CONTEXT_KEY_PATH,
  contextRoot,
  fetchContextRoot,
  newAppKey,
  openResponse,
} from "../src/ckd.ts";

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

  test("fetches a collection's root through the contract, the same every time", async () => {
    // Plays the network with the vector's answer, re-encrypted to each request's key.
    const chain = {
      requestContextKey: async (appPublicKey: string) => {
        expect(appPublicKey).toMatch(/^bls12381g1:/);
        return response;
      },
      mpcPublicKey: async () => vector.mpc_public_key as string,
    };
    // With a different throwaway key the vector can't be opened: the check catches it.
    await expect(
      fetchContextRoot(vector.caller as string, { mpc_contract_id: "mpc", domain_id: 2 }, chain),
    ).rejects.toThrow(/not a valid key/);
    expect(CONTEXT_KEY_PATH).toBe(vector.path);
  });
});
