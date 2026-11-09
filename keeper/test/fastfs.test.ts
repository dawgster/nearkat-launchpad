import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { decodeFastfs, encodeFastfs, FastfsStore, parseRef } from "../src/fastfs.ts";
import { FileStore, MirroredStore } from "../src/store.ts";

const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const TX = "4Ze6vaV85aaEsmYasL2K7hTgXUoHoaVWKvjEbjJi";

/** A chain that remembers uploads by transaction, as an archival node would. */
function fakeChain() {
  const txs = new Map<string, { sender: string; args: Uint8Array[] }>();
  let n = 0;
  return {
    txs,
    upload: async (_receiver: string, args: Uint8Array) => {
      const hash = `${TX}${String(n++).padStart(4, "A").replace(/0/g, "B")}`;
      txs.set(hash, { sender: "keeper.near", args: [args] });
      return hash;
    },
    uploadMany: async (_receiver: string, argsList: Uint8Array[]) => {
      const hash = `${TX}${String(n++).padStart(4, "A").replace(/0/g, "B")}`;
      txs.set(hash, { sender: "keeper.near", args: argsList });
      return hash;
    },
    transactionArgs: async (hash: string): Promise<Uint8Array[]> => {
      const tx = txs.get(hash);
      if (!tx) {
        throw new Error("unknown transaction");
      }
      return tx.args;
    },
  };
}

describe("FastFS encoding", () => {
  test("is the Borsh layout FastNear's indexer reads", () => {
    const encoded = encodeFastfs("a/b.bin", new Uint8Array([1, 2]));
    expect(encoded.toString("hex")).toBe(
      // variant 0, path "a/b.bin", Some, mime, 2 bytes of content
      "00" +
        "07000000" +
        Buffer.from("a/b.bin").toString("hex") +
        "01" +
        "18000000" +
        Buffer.from("application/octet-stream").toString("hex") +
        "02000000" +
        "0102",
    );
    expect(decodeFastfs(encoded)).toEqual({
      relativePath: "a/b.bin",
      content: new Uint8Array([1, 2]),
    });
  });

  test("refuses truncated data", () => {
    expect(() => decodeFastfs(encodeFastfs("p", new Uint8Array([1])).subarray(0, 10))).toThrow(
      /truncated/,
    );
  });
});

describe("FastfsStore", () => {
  const blob = new Uint8Array([9, 8, 7, 6]);

  test("putMany stores several files in one transaction and reads each back", async () => {
    const chain = fakeChain();
    const store = new FastfsStore({
      uploader: "keeper.near",
      receiver: "lantern.launch.near",
      ...chain,
      gatewayUrl: null,
    });
    const blobs = [new Uint8Array([1, 1]), new Uint8Array([2, 2]), new Uint8Array([3, 3])];
    const refs = await store.putMany(blobs);
    expect(chain.txs.size).toBe(1);
    expect(new Set(refs.map((r) => parseRef(r).txHash)).size).toBe(1);
    for (const [i, ref] of refs.entries()) {
      expect(await store.get(ref)).toEqual(blobs[i]);
    }
  });

  test("uploads to the collection and records who, what and where", async () => {
    const chain = fakeChain();
    const store = new FastfsStore({
      uploader: "keeper.near",
      receiver: "lantern.launch.near",
      ...chain,
      gatewayUrl: null,
    });
    const ref = await store.put(blob);
    expect(parseRef(ref)).toMatchObject({ uploader: "keeper.near", sha256: sha(blob) });
    expect(ref.length).toBeLessThanOrEqual(256);
    // With no gateway, it reads the upload back from the chain.
    expect(await store.get(ref)).toEqual(blob);
  });

  test("reads from a gateway first, and checks what it serves", async () => {
    const chain = fakeChain();
    const urls: string[] = [];
    const store = (served: Uint8Array) =>
      new FastfsStore({
        uploader: "keeper.near",
        receiver: "lantern.launch.near",
        ...chain,
        gatewayUrl: (u, r, p) => `https://${u}.fastfs.io/${r}/${p}`,
        fetch: (async (url: string) => {
          urls.push(url);
          return new Response(Buffer.from(served));
        }) as unknown as typeof fetch,
      });
    const ref = await store(blob).put(blob);
    expect(await store(blob).get(ref)).toEqual(blob);
    expect(urls[0]).toBe(
      `https://keeper.near.fastfs.io/lantern.launch.near/nearkat/${sha(blob)}.bin`,
    );

    // A gateway serving something else is ignored; the chain has the real thing.
    expect(await store(new Uint8Array([0])).get(ref)).toEqual(blob);
  });

  test("refuses a ref whose transaction holds something else", async () => {
    const chain = fakeChain();
    const store = new FastfsStore({
      uploader: "keeper.near",
      receiver: "lantern.launch.near",
      ...chain,
      gatewayUrl: null,
    });
    const ref = await store.put(blob);
    const forged = ref.replace(sha(blob), "0".repeat(64));
    await expect(store.get(forged)).rejects.toThrow(/is not in transaction/);
  });

  test("refuses refs that aren't FastFS refs", async () => {
    expect(() => parseRef("../etc/passwd")).toThrow(/Not a FastFS context ref/);
  });
});

describe("FastFS with a disk cache", () => {
  test("uploads before returning the ref, and a fresh disk refills from the chain", async () => {
    const chain = fakeChain();
    const fastfs = () =>
      new FastfsStore({
        uploader: "keeper.near",
        receiver: "kats.near",
        upload: chain.upload,
        uploadMany: chain.uploadMany,
        transactionArgs: chain.transactionArgs,
        gatewayUrl: null,
      });
    const disk = new FileStore(await mkdtemp(join(tmpdir(), "keeper-fastfs-")));
    const blob = new Uint8Array([9, 9, 9]);
    const ref = await new MirroredStore(disk, fastfs()).put(blob);
    expect(ref).toMatch(/^fastfs:keeper\.near:/);
    expect(chain.txs.size).toBe(1);
    // The disk finds its cached copy by the hash the ref names.
    expect(Uint8Array.from(await disk.get(ref))).toEqual(blob);

    const fresh = new FileStore(await mkdtemp(join(tmpdir(), "keeper-fastfs-")));
    expect(Uint8Array.from(await new MirroredStore(fresh, fastfs()).get(ref))).toEqual(blob);
    expect(Uint8Array.from(await fresh.get(ref))).toEqual(blob);
  });
});
