import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type ContextStore, FileStore, MemoryStore, MirroredStore } from "../src/store.ts";

const blob = Buffer.from("ciphertext");

describe("FileStore", () => {
  test("returns what was stored, creating its directory", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "keeper-store-")), "nested");
    const store = new FileStore(dir);
    const ref = await store.put(blob);
    expect(Buffer.from(await store.get(ref))).toEqual(blob);
  });

  test("gives equal blobs the same ref and different blobs different refs", async () => {
    const store = new FileStore(await mkdtemp(join(tmpdir(), "keeper-store-")));
    expect(await store.put(blob)).toBe(await store.put(blob));
    expect(await store.put(blob)).not.toBe(await store.put(Buffer.from("other")));
  });

  test("survives a new instance over the same directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "keeper-store-"));
    const ref = await new FileStore(dir).put(blob);
    expect(Buffer.from(await new FileStore(dir).get(ref))).toEqual(blob);
  });

  test.each(["../etc/passwd", "", "abc", "A".repeat(64)])("rejects the ref %j", async (ref) => {
    const store = new FileStore(await mkdtemp(join(tmpdir(), "keeper-store-")));
    await expect(store.get(ref)).rejects.toThrow("Invalid context ref");
  });

  test("fails for a well-formed ref that was never stored", async () => {
    const store = new FileStore(await mkdtemp(join(tmpdir(), "keeper-store-")));
    await expect(store.get("0".repeat(64))).rejects.toThrow();
  });
});

describe("MemoryStore", () => {
  test("returns what was stored", async () => {
    const store = new MemoryStore();
    expect(Buffer.from(await store.get(await store.put(blob)))).toEqual(blob);
  });

  test("fails for an unknown ref", async () => {
    await expect(new MemoryStore().get("nope")).rejects.toThrow("Unknown context ref");
  });
});

describe("MirroredStore", () => {
  /** A durable store that batches, counting its calls. */
  class Batching extends MemoryStore {
    batches: number[] = [];
    singles = 0;
    override async put(blob: Uint8Array) {
      this.singles += 1;
      return super.put(blob);
    }
    async putMany(blobs: Uint8Array[]) {
      this.batches.push(blobs.length);
      const refs: string[] = [];
      for (const blob of blobs) {
        refs.push(await super.put(blob));
      }
      return refs;
    }
  }
  const blobs = [1, 2, 3].map((n) => Uint8Array.from([n, n, n]));

  test("stores a batch in one durable call and mirrors each blob", async () => {
    const durable = new Batching();
    const local = new MemoryStore();
    const store = new MirroredStore(local, durable);
    const refs = await store.putMany(blobs);
    expect(durable.batches).toEqual([3]);
    expect(durable.singles).toBe(0);
    for (const [i, ref] of refs.entries()) {
      expect(await local.get(ref)).toEqual(blobs[i]);
    }
  });

  test("stores a batch one by one when the durable store can't batch", async () => {
    const durable: ContextStore = new MemoryStore();
    const store = new MirroredStore(new MemoryStore(), durable);
    const refs = await store.putMany(blobs);
    for (const [i, ref] of refs.entries()) {
      expect(await durable.get(ref)).toEqual(blobs[i]);
    }
  });
});
