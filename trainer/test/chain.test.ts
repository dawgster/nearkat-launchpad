import { randomBytes } from "node:crypto";
import { base58 } from "@scure/base";
import type { Near } from "near-kit";
import { describe, expect, test, vi } from "vitest";
import { FastfsStore } from "../../keeper/src/fastfs.ts";
import { NearTrainerChain } from "../src/chain.ts";

describe("NearTrainerChain.fastfsStore", () => {
  test("reads each FastFS transaction once per run, however many samples it holds", async () => {
    // A keeper's ingest: 20 samples in one transaction.
    const txs = new Map<string, Uint8Array[]>();
    const keeper = new FastfsStore({
      uploader: "keeper.near",
      receiver: "set.near",
      upload: async () => {
        throw new Error("unused");
      },
      uploadMany: async (_receiver, list) => {
        const hash = base58.encode(randomBytes(32));
        txs.set(hash, list);
        return hash;
      },
      transactionArgs: async () => [],
      gatewayUrl: null,
    });
    const blobs = Array.from({ length: 20 }, () => randomBytes(64));
    const refs = await keeper.putMany(blobs);

    const transactionArgs = vi.fn(async (hash: string) => txs.get(hash) ?? []);
    const chain = new NearTrainerChain({} as Near, {
      signerId: "trainer.near",
      transactionArgs,
      gatewayUrl: null,
    });
    const store = chain.fastfsStore("set.near");
    const read = await Promise.all(refs.map((ref) => store.get(ref)));
    expect(read.map((blob) => Buffer.from(blob))).toEqual(blobs);
    expect(transactionArgs).toHaveBeenCalledTimes(1);
    // A new run reads afresh.
    await chain.fastfsStore("set.near").get(refs[0] as string);
    expect(transactionArgs).toHaveBeenCalledTimes(2);
  });

  test("a failed read is tried again, not remembered", async () => {
    const transactionArgs = vi.fn(async () => {
      throw new Error("archival node down");
    });
    const chain = new NearTrainerChain({} as Near, {
      signerId: "trainer.near",
      transactionArgs,
      gatewayUrl: null,
    });
    const store = chain.fastfsStore("set.near");
    const ref = `fastfs:keeper.near:${"a".repeat(64)}:${base58.encode(randomBytes(32))}`;
    await expect(store.get(ref)).rejects.toThrow();
    await expect(store.get(ref)).rejects.toThrow();
    expect(transactionArgs).toHaveBeenCalledTimes(2);
  });
});
