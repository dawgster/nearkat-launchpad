import { hkdfSync } from "node:crypto";
import { bls12_381 as bls } from "@noble/curves/bls12-381.js";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { base58 } from "@scure/base";
import type { KeyChain } from "./chain.ts";

/**
 * Context keys from NEAR's MPC network (confidential key derivation, CKD).
 *
 * The keeper makes a throwaway BLS12-381 key pair and asks the collection
 * contract for its context key. The contract forwards the request to the MPC
 * network, which derives a key bound to the collection's account and returns
 * it ElGamal-encrypted to the throwaway key. The keeper decrypts it, checks
 * it is the network's BLS signature on the collection's app id, and derives
 * every token's key from it. Formats follow the near/mpc repository.
 */

/** Where a collection's context keys come from, as its contract publishes it. */
export interface KeySource {
  mpc_contract_id: string;
  domain_id: number;
}

/** The derivation path prefix the collection contract requests; the epoch follows it. Must match the contract. */
export const CONTEXT_KEY_PATH = "nearkat/contexts/v1";

/** The derivation path prefix of a dataset's samples; the token id follows it. Must match the contract. */
export const SAMPLE_KEY_PATH = "nearkat/samples/v1";

export const sampleKeyPath = (tokenId: string) => `${SAMPLE_KEY_PATH}/${tokenId}`;

/** Epoch 0 is the key from before epochs existed: the bare path. */
export const contextKeyPath = (epoch: number) =>
  epoch === 0 ? CONTEXT_KEY_PATH : `${CONTEXT_KEY_PATH}/${epoch}`;

/** How long a failed key request is remembered before it is tried again. */
const RETRY_FAILED_KEY_MS = 30_000;
const NEAR_CKD_DOMAIN = "NEAR BLS12381G1_XMD:SHA-256_SSWU_RO_";
const APP_ID_DERIVATION_PREFIX = "near-mpc v0.1.0 app_id derivation:";

const G1 = bls.G1.Point;
const G2 = bls.G2.Point;

function decode(prefix: "bls12381g1:" | "bls12381g2:", text: string): Uint8Array {
  if (!text.startsWith(prefix)) {
    throw new Error(`Expected a ${prefix} key, got ${text.slice(0, 16)}…`);
  }
  return base58.decode(text.slice(prefix.length));
}

/** The app id the MPC network derives for a caller and path. */
export function appId(callerAccountId: string, path: string): Uint8Array {
  return sha3_256(
    new TextEncoder().encode(`${APP_ID_DERIVATION_PREFIX}${callerAccountId},${path}`),
  );
}

/** `H(pk ‖ app_id)`: the point the MPC network signs for an app, hashed to G1 as the network does. */
export function hashAppId(mpcPublicKey: Uint8Array, app: Uint8Array) {
  return bls.G1.hashToCurve(new Uint8Array([...mpcPublicKey, ...app]), {
    DST: NEAR_CKD_DOMAIN,
  }) as unknown as InstanceType<typeof G1>;
}

/** A throwaway key pair for one request. The secret never leaves the keeper. */
export function newAppKey(): { secret: bigint; publicKey: string } {
  const secret = bls.fields.Fr.fromBytes(bls.utils.randomSecretKey());
  const point = G1.BASE.multiply(secret);
  return { secret, publicKey: `bls12381g1:${base58.encode(point.toBytes(true))}` };
}

/**
 * Decrypts the MPC network's response and checks it: the result must be the
 * network's BLS signature on the app id, `e(K, G2) = e(H(pk ‖ app_id), pk)`.
 * Returns the derived key, 48 bytes, compressed.
 */
export function openResponse(
  response: { big_y: string; big_c: string },
  secret: bigint,
  mpcPublicKey: string,
  app: Uint8Array,
): Uint8Array {
  const y = G1.fromBytes(decode("bls12381g1:", response.big_y));
  const c = G1.fromBytes(decode("bls12381g1:", response.big_c));
  const derived = c.subtract(y.multiply(secret));
  const pkBytes = decode("bls12381g2:", mpcPublicKey);
  const pk = G2.fromBytes(pkBytes);
  const hashed = hashAppId(pkBytes, app);
  const valid =
    !derived.is0() && bls.fields.Fp12.eql(bls.pairing(derived, G2.BASE), bls.pairing(hashed, pk));
  if (!valid) {
    throw new Error("The MPC network's answer is not a valid key for this collection");
  }
  return derived.toBytes(true);
}

/**
 * The 32-byte root every token key of a collection is derived from. Uses the
 * HKDF salt of NEAR's own CKD example, with an `info` naming this purpose.
 */
export function contextRoot(derivedKey: Uint8Array): Buffer {
  return Buffer.from(
    hkdfSync("sha256", derivedKey, "near-mpc-ckd-hkdf-v1", "nearkat/contexts/v1", 32),
  );
}

/** The 32-byte AES key of one sample, from the key the MPC network derived for its path. */
export function sampleKey(derivedKey: Uint8Array, tokenId: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", derivedKey, "near-mpc-ckd-hkdf-v1", sampleKeyPath(tokenId), 32),
  );
}

/** The most keys one call asks for: what the contract allows. */
export const MAX_SAMPLE_KEYS_PER_CALL = 10;

/**
 * SAMPLE_KEYS_PER_CALL, for the keeper and the training app alike: 1 to
 * MAX_SAMPLE_KEYS_PER_CALL, the most by default. Use 1 with the sandbox's
 * mock MPC, which costs ~120 Tgas per key.
 */
export function sampleKeysPerCallFrom(env: NodeJS.ProcessEnv): number {
  const value = Number(env.SAMPLE_KEYS_PER_CALL ?? String(MAX_SAMPLE_KEYS_PER_CALL));
  if (!Number.isInteger(value) || value < 1 || value > MAX_SAMPLE_KEYS_PER_CALL) {
    throw new Error(
      `SAMPLE_KEYS_PER_CALL must be a whole number from 1 to ${MAX_SAMPLE_KEYS_PER_CALL}`,
    );
  }
  return value;
}

/**
 * Every listed sample's key. Asks the collection in chunks of `perCall` (up
 * to ten), in parallel, each with its own throwaway key, and checks every
 * answer is the network's signature on that sample's app id. Use 1 with the
 * sandbox's mock MPC, which spends about 120 Tgas on each key.
 */
export async function fetchSampleKeys(
  collectionId: string,
  request: (
    tokenIds: string[],
    appPublicKey: string,
  ) => Promise<Array<{ big_y: string; big_c: string } | null>>,
  mpcPublicKey: string,
  tokenIds: string[],
  perCall = MAX_SAMPLE_KEYS_PER_CALL,
  /** Calls in flight at once; all of them when unset. */
  parallel = Number.POSITIVE_INFINITY,
): Promise<Map<string, Buffer>> {
  if (!Number.isInteger(perCall) || perCall < 1 || perCall > MAX_SAMPLE_KEYS_PER_CALL) {
    throw new Error(`Ask for 1 to ${MAX_SAMPLE_KEYS_PER_CALL} sample keys per call`);
  }
  const chunks: string[][] = [];
  for (let i = 0; i < tokenIds.length; i += perCall) {
    chunks.push(tokenIds.slice(i, i + perCall));
  }
  const keys = new Map<string, Buffer>();
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      await fetchChunk(chunks[next++] as string[]);
    }
  };
  const fetchChunk = async (chunk: string[]) => {
    const app = newAppKey();
    const answers = await request(chunk, app.publicKey);
    for (const [i, id] of chunk.entries()) {
      const answer = answers[i];
      if (!answer) {
        throw new Error(`No key for sample ${id}`);
      }
      let derived: Uint8Array;
      try {
        derived = openResponse(
          answer,
          app.secret,
          mpcPublicKey,
          appId(collectionId, sampleKeyPath(id)),
        );
      } catch {
        throw new Error(`No key for sample ${id}`);
      }
      keys.set(id, sampleKey(derived, id));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, chunks.length)) }, worker));
  return keys;
}

/** Fetches, decrypts and checks a collection's context root for one key epoch. */
export async function fetchContextRoot(
  collectionId: string,
  source: KeySource,
  chain: KeyChain,
  epoch: number,
): Promise<Buffer> {
  const key = newAppKey();
  const [response, mpcPublicKey] = await Promise.all([
    chain.requestContextKey(key.publicKey, epoch),
    chain.mpcPublicKey(source),
  ]);
  const derived = openResponse(
    response,
    key.secret,
    mpcPublicKey,
    appId(collectionId, contextKeyPath(epoch)),
  );
  return contextRoot(derived);
}

/** A collection's context keys, by key epoch. */
export interface Keyring {
  /** The epoch new contexts are saved under. */
  currentEpoch(): Promise<number>;
  /** The AES-256-GCM key of one token's context under an epoch. */
  katKey(tokenId: string, epoch: number): Promise<Buffer>;
  /**
   * The collection has moved on: to `epoch` when the contract said which,
   * otherwise the current epoch is read again.
   */
  refresh(epoch?: number): void;
}

/**
 * Context keys from NEAR's MPC network. Each epoch's root is fetched once,
 * when first needed, and kept in memory only; a failed fetch is retried on
 * the next use.
 */
export class MpcKeyring implements Keyring {
  readonly #collectionId: string;
  readonly #source: KeySource;
  readonly #chain: KeyChain;
  readonly #now: () => number;
  readonly #roots = new Map<number, Promise<Buffer>>();
  /** Requests that failed, so a failing epoch doesn't cost a paid request on every read. */
  readonly #failed = new Map<number, { error: unknown; at: number }>();
  #epoch: Promise<number> | null = null;
  /** The highest epoch seen. Epochs only move forward on-chain, so neither may this. */
  #highest = 0;

  constructor(collectionId: string, source: KeySource, chain: KeyChain, now = Date.now) {
    this.#collectionId = collectionId;
    this.#source = source;
    this.#chain = chain;
    this.#now = now;
  }

  currentEpoch(): Promise<number> {
    if (!this.#epoch) {
      const epoch = this.#chain.getKeyEpoch().then((seen) => {
        // A view can trail the contract by a block or two.
        this.#highest = Math.max(this.#highest, seen);
        return this.#highest;
      });
      this.#epoch = epoch;
      epoch.catch(() => {
        if (this.#epoch === epoch) {
          this.#epoch = null;
        }
      });
    }
    return this.#epoch;
  }

  refresh(epoch?: number): void {
    if (epoch === undefined) {
      this.#epoch = null;
    } else if (epoch > this.#highest) {
      // The contract's own answer beats a view. A lower one comes from a
      // refusal that raced a newer one, and is ignored.
      this.#highest = epoch;
      this.#epoch = Promise.resolve(epoch);
    }
  }

  async katKey(tokenId: string, epoch: number): Promise<Buffer> {
    if (!Number.isInteger(epoch) || epoch < 0) {
      throw new Error(`No context key for epoch ${epoch}`);
    }
    return Buffer.from(
      hkdfSync("sha256", await this.#root(epoch), Buffer.alloc(0), `nearkat/kat/${tokenId}`, 32),
    );
  }

  /** Fetches the current epoch's key, so a collection whose key can't be had isn't served. */
  async ready(): Promise<void> {
    await this.#root(await this.currentEpoch());
  }

  #root(epoch: number): Promise<Buffer> {
    const failed = this.#failed.get(epoch);
    if (failed && this.#now() - failed.at < RETRY_FAILED_KEY_MS) {
      return Promise.reject(failed.error);
    }
    let root = this.#roots.get(epoch);
    if (!root) {
      root = fetchContextRoot(this.#collectionId, this.#source, this.#chain, epoch);
      this.#roots.set(epoch, root);
      this.#failed.delete(epoch);
      root.catch((error) => {
        this.#roots.delete(epoch);
        this.#failed.set(epoch, { error, at: this.#now() });
      });
    }
    return root;
  }
}
