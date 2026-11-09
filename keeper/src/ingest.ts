import { createHash } from "node:crypto";
import type { Chain } from "./chain.ts";
import { fetchSampleKeys, type KeySource } from "./ckd.ts";
import { HttpError } from "./errors.ts";
import type { FastfsStore } from "./fastfs.ts";
import { SAMPLE_INFO, sealSample } from "./samples.ts";
import type { SealingKey } from "./sealing.ts";
import type { ContextStore } from "./store.ts";

/** Samples accepted per call. */
export const MAX_SAMPLES_PER_CALL = 25;
/** The longest sealed sample: a 96 KB JPEG as base64, in JSON, sealed and base64-encoded again. */
export const MAX_SEALED_CHARS = 180_000;
const MAX_JPEG_BYTES = 96 * 1024;
const STORE_CHUNK = 20;
const RECORD_CHUNK = 50;
const MAX_FINISH_CALLS = 25;

export interface IngestOptions {
  contractId: string;
  chain: Chain;
  store: FastfsStore | ContextStore;
  sealing: SealingKey;
  keySource: KeySource;
  mpcPublicKey: () => Promise<string>;
  /** Sample keys asked for per call, 1 to 10. Defaults to 10. */
  keysPerCall?: number;
}

const bad = (message: string) => new HttpError(400, "invalid_input", message);

/**
 * Takes a dataset's training images, which the creator's browser sealed to
 * the keeper's attested key, and keeps each one sealed under its own key from
 * the MPC network: stored, with its hash and place recorded on-chain.
 */
export class Ingest {
  readonly #o: IngestOptions;

  constructor(options: IngestOptions) {
    this.#o = options;
  }

  async seal(
    caller: string,
    samples: Array<{ token_id: string; sealed: string }>,
  ): Promise<{ sealed: string[]; skipped: string[] }> {
    const { chain } = this.#o;
    if (caller !== (await chain.getAdminId())) {
      throw new HttpError(403, "forbidden", "Only the collection's creator can add samples");
    }
    const dataset = await chain.getDatasetInfo();
    if (!dataset) {
      throw new HttpError(409, "not_a_dataset", "This is not a dataset collection");
    }
    if (samples.length < 1 || samples.length > MAX_SAMPLES_PER_CALL) {
      throw bad(`Send 1 to ${MAX_SAMPLES_PER_CALL} samples at a time`);
    }
    const seen = new Set<string>();
    for (const sample of samples) {
      if (
        typeof sample?.token_id !== "string" ||
        !/^\d{1,20}$/.test(sample.token_id) ||
        typeof sample.sealed !== "string"
      ) {
        throw bad("Each sample needs a token_id and a sealed string");
      }
      if (sample.sealed.length > MAX_SEALED_CHARS) {
        throw bad(`Sample ${sample.token_id} is too large`);
      }
      if (seen.has(sample.token_id)) {
        throw bad(`Sample ${sample.token_id} is listed twice`);
      }
      seen.add(sample.token_id);
    }

    // Tokens that aren't minted yet can't be sealed.
    await this.#finishMinting();

    const skipped: string[] = [];
    const todo: Array<{ tokenId: string; label: string; jpeg: string }> = [];
    for (const { token_id: tokenId, sealed } of samples) {
      const existing = await chain.getSample(tokenId);
      if (!existing) {
        throw bad(`Token ${tokenId} does not exist`);
      }
      if (existing.sample_ref) {
        skipped.push(tokenId);
        continue;
      }
      todo.push({ tokenId, ...this.#open(tokenId, sealed, dataset.classes) });
    }
    if (todo.length === 0) {
      return { sealed: [], skipped };
    }

    const keys = await fetchSampleKeys(
      this.#o.contractId,
      this.#o.keySource,
      (ids, appPublicKey) => chain.requestIngestKeys(ids, appPublicKey),
      await this.#o.mpcPublicKey(),
      todo.map((t) => t.tokenId),
      this.#o.keysPerCall,
    );
    const blobs = todo.map(({ tokenId, label, jpeg }) =>
      sealSample(keys.get(tokenId) as Buffer, { v: 1, token_id: tokenId, label, jpeg }),
    );
    const refs: string[] = [];
    const { store } = this.#o;
    for (let i = 0; i < blobs.length; i += STORE_CHUNK) {
      const chunk = blobs.slice(i, i + STORE_CHUNK);
      if ("putMany" in store) {
        refs.push(...(await store.putMany(chunk)));
      } else {
        for (const blob of chunk) {
          refs.push(await store.put(blob));
        }
      }
    }
    const items = todo.map(({ tokenId }, i): [string, string, string] => [
      tokenId,
      createHash("sha256")
        .update(blobs[i] as Buffer)
        .digest("base64"),
      refs[i] as string,
    ]);
    for (let i = 0; i < items.length; i += RECORD_CHUNK) {
      await chain.setSamples(items.slice(i, i + RECORD_CHUNK));
    }
    return { sealed: todo.map((t) => t.tokenId), skipped };
  }

  async #finishMinting(): Promise<void> {
    const { chain } = this.#o;
    for (let calls = 0; ; calls++) {
      const { minted, max_supply } = await chain.getSupply();
      if (max_supply === null || minted >= max_supply) {
        return;
      }
      if (calls >= MAX_FINISH_CALLS) {
        throw new HttpError(
          503,
          "minting_unfinished",
          `Minting did not finish after ${MAX_FINISH_CALLS} calls`,
        );
      }
      await chain.finishMinting();
    }
  }

  /** Opens one sealed sample and checks it; the message names the token, never the content. */
  #open(tokenId: string, sealed: string, classes: string[]): { label: string; jpeg: string } {
    let doc: { label?: unknown; jpeg?: unknown };
    try {
      doc = JSON.parse(this.#o.sealing.open(sealed, SAMPLE_INFO));
    } catch {
      throw bad(`Sample ${tokenId} could not be opened: seal it to this keeper's key`);
    }
    const { label, jpeg } = doc ?? {};
    if (typeof label !== "string" || !classes.includes(label)) {
      throw bad(`Sample ${tokenId} has a label that is not one of the classes`);
    }
    if (typeof jpeg !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(jpeg)) {
      throw bad(`Sample ${tokenId} must carry a base64 JPEG`);
    }
    const bytes = Buffer.from(jpeg, "base64");
    if (bytes.length > MAX_JPEG_BYTES) {
      throw bad(`Sample ${tokenId}'s picture is over ${MAX_JPEG_BYTES / 1024} KB`);
    }
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw bad(`Sample ${tokenId} is not a JPEG`);
    }
    return { label, jpeg };
  }
}
