import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { appId, fetchSampleKeys, openResponse, sampleKey, sampleKeyPath } from "../src/ckd.ts";
import { openSample, type SampleDoc, sealSample } from "../src/samples.ts";
import { FakeChain, KEY_SOURCE } from "./fakes.ts";

const vector = JSON.parse(
  readFileSync(join(process.cwd(), "test/fixtures/ckd-sample-vector.json"), "utf8"),
) as Record<string, string>;

const doc = (tokenId: string): SampleDoc => ({
  v: 1,
  token_id: tokenId,
  label: "cat",
  jpeg: Buffer.from([0xff, 0xd8, 1, 2, 3]).toString("base64"),
});

describe("samples", () => {
  const key = Buffer.alloc(32, 5);

  test("seals and opens a sample for its token", () => {
    const blob = sealSample(key, doc("1"));
    expect(openSample(key, blob, "1")).toEqual(doc("1"));
  });

  test("refuses a sample sealed for another token", () => {
    const blob = sealSample(key, doc("1"));
    expect(() => openSample(key, blob, "2")).toThrow(/not sample 2/);
  });

  test("sample keys come from the MPC answer for that token's path", () => {
    expect(sampleKeyPath("1")).toBe(vector.path);
    const derived = openResponse(
      { big_y: vector.big_y as string, big_c: vector.big_c as string },
      BigInt(vector.app_secret as string),
      vector.mpc_public_key as string,
      appId(vector.caller as string, sampleKeyPath("1")),
    );
    const k = sampleKey(derived, "1");
    expect(k).toHaveLength(32);
    expect(k.equals(sampleKey(derived, "2"))).toBe(false);
    // A different token's path is not what the network answered for.
    expect(() =>
      openResponse(
        { big_y: vector.big_y as string, big_c: vector.big_c as string },
        BigInt(vector.app_secret as string),
        vector.mpc_public_key as string,
        appId(vector.caller as string, sampleKeyPath("2")),
      ),
    ).toThrow(/not a valid key/);
  });

  test("fetchSampleKeys asks in chunks of ten", async () => {
    const chain = new FakeChain();
    const ids = Array.from({ length: 23 }, (_, i) => String(i + 1));
    const sizes: number[] = [];
    const keys = await fetchSampleKeys(
      chain.contractId,
      KEY_SOURCE,
      async (tokenIds, appPublicKey) => {
        sizes.push(tokenIds.length);
        return chain.requestIngestKeys(tokenIds, appPublicKey);
      },
      await chain.mpcPublicKey(KEY_SOURCE),
      ids,
    );
    expect(sizes.sort((a, b) => a - b)).toEqual([3, 10, 10]);
    expect(keys.size).toBe(23);
    expect(keys.get("1")?.equals(keys.get("2") as Buffer)).toBe(false);
  });

  test("a missing answer names the sample", async () => {
    const chain = new FakeChain();
    await expect(
      fetchSampleKeys(
        chain.contractId,
        KEY_SOURCE,
        async (ids) => ids.map(() => null),
        await chain.mpcPublicKey(KEY_SOURCE),
        ["7"],
      ),
    ).rejects.toThrow("No key for sample 7");
  });
});
