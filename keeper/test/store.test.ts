import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FileStore, MemoryStore } from "../src/store.ts";

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
