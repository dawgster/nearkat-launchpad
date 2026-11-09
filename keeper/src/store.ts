import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseRef } from "./fastfs.ts";

/** Holds encrypted context blobs. Never sees plaintext. */
export interface ContextStore {
  /** Stores a blob and returns an opaque reference to it. */
  put(blob: Uint8Array): Promise<string>;
  get(ref: string): Promise<Uint8Array>;
}

function refOf(blob: Uint8Array): string {
  return createHash("sha256").update(blob).digest("hex");
}

/** Local-disk store for development and testnet. */
export class FileStore implements ContextStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  async put(blob: Uint8Array): Promise<string> {
    const ref = refOf(blob);
    await mkdir(this.#dir, { recursive: true });
    await writeFile(join(this.#dir, ref), blob);
    return ref;
  }

  async get(ref: string): Promise<Uint8Array> {
    // A FastFS ref names the same hash, so its cached copy is found by it.
    const hash = ref.startsWith("fastfs:") ? parseRef(ref).sha256 : ref;
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error(`Invalid context ref: ${ref}`);
    }
    return readFile(join(this.#dir, hash));
  }
}

/**
 * Durable storage with a local cache. A blob is stored durably before its
 * reference is returned, so its hash never moves on-chain ahead of it.
 */
export class MirroredStore implements ContextStore {
  readonly #local: ContextStore;
  readonly #durable: ContextStore;

  constructor(local: ContextStore, durable: ContextStore) {
    this.#local = local;
    this.#durable = durable;
  }

  async put(blob: Uint8Array): Promise<string> {
    const ref = await this.#durable.put(blob);
    await this.#local.put(blob).catch(() => undefined);
    return ref;
  }

  /**
   * Stores several blobs, in one durable call when the durable store batches
   * (FastFS: one transaction), then mirrors each locally. Refs in order.
   */
  async putMany(blobs: Uint8Array[]): Promise<string[]> {
    const durable = this.#durable as ContextStore & {
      putMany?: (blobs: Uint8Array[]) => Promise<string[]>;
    };
    let refs: string[];
    if (typeof durable.putMany === "function") {
      refs = await durable.putMany(blobs);
    } else {
      refs = [];
      for (const blob of blobs) {
        refs.push(await durable.put(blob));
      }
    }
    for (const blob of blobs) {
      await this.#local.put(blob).catch(() => undefined);
    }
    return refs;
  }

  async get(ref: string): Promise<Uint8Array> {
    try {
      return await this.#local.get(ref);
    } catch {
      const blob = await this.#durable.get(ref);
      await this.#local.put(blob).catch(() => undefined);
      return blob;
    }
  }
}

export class MemoryStore implements ContextStore {
  readonly #blobs = new Map<string, Uint8Array>();

  async put(blob: Uint8Array): Promise<string> {
    const ref = refOf(blob);
    this.#blobs.set(ref, Uint8Array.from(blob));
    return ref;
  }

  async get(ref: string): Promise<Uint8Array> {
    const blob = this.#blobs.get(ref);
    if (!blob) {
      throw new Error(`Unknown context ref: ${ref}`);
    }
    return blob;
  }
}
