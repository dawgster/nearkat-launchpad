import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
    if (!/^[0-9a-f]{64}$/.test(ref)) {
      throw new Error(`Invalid context ref: ${ref}`);
    }
    return readFile(join(this.#dir, ref));
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
