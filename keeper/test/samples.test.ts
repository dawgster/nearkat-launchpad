import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { appId, fetchSampleKeys, openResponse, sampleKey, sampleKeyPath } from "../src/ckd.ts";
import { seal } from "../src/crypto.ts";
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

  test("refuses a blob whose JSON is not a sample", () => {
    for (const text of ["null", "7", '"x"', "[]"]) {
      expect(() => openSample(key, seal(key, Buffer.from(text)), "1"), text).toThrow(
        /not sample 1/,
      );
    }
  });

  test("a sample key is HKDF-SHA256 of the derived key, salted, with the token's path", () => {
    // Worked out separately with Python's hmac: HKDF(salt "near-mpc-ckd-hkdf-v1", info "nearkat/samples/v1/1").
    const derived = Buffer.from(
      "80cf1eb6d3ac851fd67a879ae4216434e9b009bd4cb1c5d98e98f6e03b7f1460f57e1e4f7483065c18400d6dbe509c8d",
      "hex",
    );
    expect(sampleKey(derived, "1").toString("hex")).toBe(
      "d3c0cba41f2d77fcfefdda2bbf97ddd8dd129b899809206b65788163753545da",
    );
  });

  test("sample keys come from the MPC answer for that token's path", () => {
    expect(sampleKeyPath("1")).toBe(vector.path);
    const derived = openResponse(
      { big_y: vector.big_y as string, big_c: vector.big_c as string },
      BigInt(vector.app_secret as string),
      vector.mpc_public_key as string,
      appId(vector.caller as string, sampleKeyPath("1")),
    );
    expect(Buffer.from(derived).toString("hex")).toBe(
      "80cf1eb6d3ac851fd67a879ae4216434e9b009bd4cb1c5d98e98f6e03b7f1460f57e1e4f7483065c18400d6dbe509c8d",
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
          async () => [],
          await chain.mpcPublicKey(KEY_SOURCE),
          ["1"],
          perCall,
        ),
      ).rejects.toThrow(/1 to 10/);
    }
  });

  test("fetchSampleKeys refuses another token's answer in a token's place", async () => {
    const chain = new FakeChain();
    await expect(
      fetchSampleKeys(
        chain.contractId,
        // Answers for 2 and 1, given for 1 and 2.
        async (ids, appPublicKey) => chain.requestIngestKeys([...ids].reverse(), appPublicKey),
        await chain.mpcPublicKey(KEY_SOURCE),
        ["1", "2"],
      ),
    ).rejects.toThrow("No key for sample 1");
  });

  test("a missing answer names the sample", async () => {
    const chain = new FakeChain();
    await expect(
      fetchSampleKeys(
        chain.contractId,
        async (ids) => ids.map(() => null),
        await chain.mpcPublicKey(KEY_SOURCE),
        ["7"],
      ),
    ).rejects.toThrow("No key for sample 7");
  });
});
