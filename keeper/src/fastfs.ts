import { createHash } from "node:crypto";
import type { ContextStore } from "./store.ts";

/**
 * Encrypted contexts stored on NEAR itself, as FastFS files.
 *
 * A FastFS file is the argument of a `__fastdata_fastfs` call: it lives in
 * NEAR's transaction history, not in any contract's state. FastFS indexers
 * serve it at `https://<uploader>.fastfs.io/<receiver>/<path>`; any archival
 * NEAR node can also return the transaction, so no single service has to stay
 * up. The keeper uploads each context to its collection's account, and the
 * reference it records on-chain names the uploader, the blob's SHA-256 and the
 * transaction, so whoever reads it can find it and check it.
 *
 * Format, from FastNear's indexer: Borsh of
 * `FastfsData::Simple(SimpleFastfs { relative_path, content: Some(FastfsFileContent { mime_type, content }) })`.
 */

const sha256Hex = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const MIME = "application/octet-stream";

function u32(n: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(n);
  return out;
}

const string = (text: string) => {
  const bytes = Buffer.from(text, "utf8");
  return Buffer.concat([u32(bytes.length), bytes]);
};

/** The Borsh encoding FastFS indexers read. */
export function encodeFastfs(relativePath: string, content: Uint8Array): Buffer {
  return Buffer.concat([
    Buffer.from([0]), // FastfsData::Simple
    string(relativePath),
    Buffer.from([1]), // Some(content)
    string(MIME),
    u32(content.length),
    Buffer.from(content),
  ]);
}

/** Reads a FastFS upload back: its path and content. */
export function decodeFastfs(args: Uint8Array): {
  relativePath: string;
  content: Uint8Array | null;
} {
  const data = Buffer.from(args);
  let at = 0;
  const take = (n: number) => {
    if (at + n > data.length) {
      throw new Error("FastFS data is truncated");
    }
    const slice = data.subarray(at, at + n);
    at += n;
    return slice;
  };
  const readU32 = () => take(4).readUInt32LE(0);
  const readString = () => take(readU32()).toString("utf8");
  if (take(1)[0] !== 0) {
    throw new Error("Not a simple FastFS file");
  }
  const relativePath = readString();
  if (take(1)[0] !== 1) {
    return { relativePath, content: null };
  }
  readString(); // mime type
  return { relativePath, content: Uint8Array.from(take(readU32())) };
}

/** The reference recorded on-chain: `fastfs:<uploader>:<sha256>:<tx hash>`. */
export interface FastfsRef {
  uploader: string;
  sha256: string;
  txHash: string;
}

export function parseRef(ref: string): FastfsRef {
  const match = /^fastfs:([a-z0-9._-]{2,64}):([0-9a-f]{64}):([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(
    ref,
  );
  if (!match) {
    throw new Error(`Not a FastFS context ref: ${ref}`);
  }
  const [, uploader = "", sha256 = "", txHash = ""] = match;
  return { uploader, sha256, txHash };
}

export interface FastfsOptions {
  /** The keeper's account, which uploads. */
  uploader: string;
  /** The collection's account, which uploads are addressed to. */
  receiver: string;
  /** Sends a `__fastdata_fastfs` call to the receiver; resolves to the transaction hash. */
  upload(receiver: string, args: Uint8Array): Promise<string>;
  /** Sends several `__fastdata_fastfs` calls to the receiver in one transaction. */
  uploadMany(receiver: string, argsList: Uint8Array[]): Promise<string>;
  /** The original arguments of every function call in a transaction, from an archival node. */
  transactionArgs(txHash: string, sender: string): Promise<Uint8Array[]>;
  /** Where a FastFS file is served over HTTP, or null for no gateway. */
  gatewayUrl: ((uploader: string, receiver: string, path: string) => string) | null;
  fetch?: typeof fetch;
}

export class FastfsStore implements ContextStore {
  readonly #o: FastfsOptions;
  readonly #fetch: typeof fetch;

  constructor(options: FastfsOptions) {
    this.#o = options;
    this.#fetch = options.fetch ?? fetch;
  }

  static path(sha256: string): string {
    return `nearkat/${sha256}.bin`;
  }

  async put(blob: Uint8Array): Promise<string> {
    const sha256 = sha256Hex(blob);
    const txHash = await this.#o.upload(
      this.#o.receiver,
      encodeFastfs(FastfsStore.path(sha256), blob),
    );
    return `fastfs:${this.#o.uploader}:${sha256}:${txHash}`;
  }

  /** Stores several blobs in one transaction; the refs come back in order. */
  async putMany(blobs: Uint8Array[]): Promise<string[]> {
    const shas = blobs.map(sha256Hex);
    const txHash = await this.#o.uploadMany(
      this.#o.receiver,
      blobs.map((blob, i) => encodeFastfs(FastfsStore.path(shas[i] as string), blob)),
    );
    return shas.map((sha256) => `fastfs:${this.#o.uploader}:${sha256}:${txHash}`);
  }

  async get(ref: string): Promise<Uint8Array> {
    const { uploader, sha256, txHash } = parseRef(ref);
    const path = FastfsStore.path(sha256);
    // Whichever source answers, the content must hash to what the ref names.
    const checked = (blob: Uint8Array | null) => (blob && sha256Hex(blob) === sha256 ? blob : null);
    if (this.#o.gatewayUrl) {
      try {
        const response = await this.#fetch(this.#o.gatewayUrl(uploader, this.#o.receiver, path), {
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) {
          const blob = checked(new Uint8Array(await response.arrayBuffer()));
          if (blob) {
            return blob;
          }
        }
      } catch {
        // Fall back to the chain itself.
      }
    }
    let blob: Uint8Array | null = null;
    for (const args of await this.#o.transactionArgs(txHash, uploader)) {
      let upload: ReturnType<typeof decodeFastfs>;
      try {
        upload = decodeFastfs(args);
      } catch {
        continue; // Not a FastFS action.
      }
      if (upload.relativePath === path) {
        blob = checked(upload.content);
        break;
      }
    }
    if (!blob) {
      throw new Error(`Context ${sha256} is not in transaction ${txHash}`);
    }
    return blob;
  }
}
