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

  test("fetchSampleKeys asks in chunks of perCall", async () => {
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
      1,
    );
    expect(sizes).toEqual(Array(23).fill(1));
    expect(keys.size).toBe(23);
  });

  test("fetchSampleKeys keeps at most `parallel` calls in flight", async () => {
    const chain = new FakeChain();
    const ids = Array.from({ length: 30 }, (_, i) => String(i + 1));
    let running = 0;
    let most = 0;
    const keys = await fetchSampleKeys(
      chain.contractId,
      KEY_SOURCE,
      async (tokenIds, appPublicKey) => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running -= 1;
        return chain.requestIngestKeys(tokenIds, appPublicKey);
      },
      await chain.mpcPublicKey(KEY_SOURCE),
      ids,
      1,
      5,
    );
    expect(most).toBe(5);
    expect(keys.size).toBe(30);
  });

  test("fetchSampleKeys asks for 1 to 10 keys per call", async () => {
    const chain = new FakeChain();
    for (const perCall of [0, 11, 1.5]) {
      await expect(
        fetchSampleKeys(
          chain.contractId,
          KEY_SOURCE,
          async () => [],
          await chain.mpcPublicKey(KEY_SOURCE),
          ["1"],
          perCall,
        ),
      ).rejects.toThrow(/1 to 10/);
    }
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
