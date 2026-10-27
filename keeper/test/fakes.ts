import { createHash } from "node:crypto";
import { bls12_381 as bls } from "@noble/curves/bls12-381.js";
import { base58 } from "@scure/base";
import type { Chain, DebitResult, KeyProof } from "../src/chain.ts";
import { appId, CONTEXT_KEY_PATH, type KeySource } from "../src/ckd.ts";
import { type CollectionInfo, DEFAULT_COLLECTION } from "../src/collection.ts";
import { InferenceError } from "../src/errors.ts";
import type { ChatResult, Inference } from "../src/inference.ts";
import type { ChatMessage, KatView } from "../src/types.ts";

export const NEAR = 10n ** 24n;

/** In-memory stand-in for the contract, enforcing the same rules. */
export class FakeChain implements Chain {
  readonly kats = new Map<string, KatView>();
  /** Every applied batch, as `[seq, items]`. */
  readonly debits: Array<[number, Array<[string, string]>]> = [];
  keeperId = "keeper.near";
  collection: CollectionInfo = DEFAULT_COLLECTION;
  inferenceAccrued = 0n;
  withdrawals = 0;
  readonly attested = new Set<string>();
  readonly proofs: KeyProof[] = [];
  debitSeq = 0;
  /** "lost": the call never reaches the contract. "unconfirmed": it applies, then the reply is lost. */
  debitFailure: "none" | "lost" | "unconfirmed" = "none";
  failSetContext = 0;
  /** When set, views keep returning the context as it was before the last save. */
  staleViews = false;
  #stale = new Map<string, KatView>();
  /** The collection's account, which the MPC network derives its key for. */
  contractId = "kats.near";
  /** The simulated MPC network's master secret. */
  mpcSecret = 0x1234_5678_9abcn;
  /** When set, context key requests fail with it. */
  ckdFailure: string | null = null;
  ckdRequests = 0;
  /** FastFS uploads, by transaction hash. */
  readonly uploads = new Map<string, Uint8Array>();

  mint(tokenId: string, owner: string, balance: bigint): void {
    this.kats.set(tokenId, {
      owner_id: owner,
      context_hash: null,
      context_ref: null,
      context_version: "0",
      balance: balance.toString(),
    });
  }

  transfer(tokenId: string, to: string): void {
    this.#kat(tokenId).owner_id = to;
  }

  async getKat(tokenId: string): Promise<KatView | null> {
    const kat = this.kats.get(tokenId);
    if (!kat) {
      return null;
    }
    const stale = this.staleViews ? this.#stale.get(tokenId) : undefined;
    return { ...(stale ?? kat), owner_id: kat.owner_id, balance: kat.balance };
  }

  async setContext(tokenId: string, hashB64: string, ref: string, version: number): Promise<void> {
    if (this.failSetContext > 0) {
      this.failSetContext -= 1;
      throw new Error("RPC unavailable");
    }
    const kat = this.#kat(tokenId);
    if (version !== Number(kat.context_version) + 1) {
      throw new Error(`Version must be ${Number(kat.context_version) + 1}`);
    }
    this.#stale.set(tokenId, { ...kat });
    kat.context_hash = hashB64;
    kat.context_ref = ref;
    kat.context_version = String(version);
  }

  async debitBatch(seq: number, items: Array<[string, string]>): Promise<DebitResult> {
    await Promise.resolve();
    if (this.debitFailure === "lost") {
      throw new Error("RPC unavailable");
    }
    if (seq !== this.debitSeq + 1) {
      return { status: "out_of_sequence", lastApplied: this.debitSeq };
    }
    // Like the contract, entries for the same kat are counted together.
    const left = new Map<string, bigint>();
    for (const [tokenId, amount] of items) {
      const balance = (left.get(tokenId) ?? BigInt(this.#kat(tokenId).balance)) - BigInt(amount);
      if (balance < 0n) {
        return { status: "insufficient", tokenId };
      }
      left.set(tokenId, balance);
    }
    for (const [tokenId, balance] of left) {
      this.#kat(tokenId).balance = balance.toString();
    }
    this.debitSeq = seq;
    this.debits.push([seq, items]);
    if (this.debitFailure === "unconfirmed") {
      throw new Error("RPC timed out");
    }
    return { status: "applied" };
  }

  async getDebitSeq(): Promise<number> {
    return this.debitSeq;
  }

  async getKeeperId(): Promise<string> {
    return this.keeperId;
  }

  async getCollection(): Promise<CollectionInfo> {
    return this.collection;
  }

  async getInferenceAccrued(): Promise<bigint> {
    return this.inferenceAccrued;
  }

  async withdrawInference(): Promise<void> {
    this.withdrawals += 1;
    this.inferenceAccrued = 0n;
  }

  async isKeyAttested(publicKey: string): Promise<boolean> {
    return this.attested.has(publicKey);
  }

  async registerKeeperKey(proof: KeyProof): Promise<void> {
    this.proofs.push(proof);
    this.attested.add(proof.public_key);
  }

  async requestContextKey(appPublicKey: string): Promise<{ big_y: string; big_c: string }> {
    this.ckdRequests += 1;
    if (this.ckdFailure) {
      throw new Error(this.ckdFailure);
    }
    // What the MPC network computes: K = msk·H(pk ‖ app_id), ElGamal-encrypted to the app key.
    const G1 = bls.G1.Point;
    const app = G1.fromBytes(base58.decode(appPublicKey.replace(/^bls12381g1:/, "")));
    const pk = bls.G2.Point.BASE.multiply(this.mpcSecret).toBytes(true);
    const hashed = bls.G1.hashToCurve(
      new Uint8Array([...pk, ...appId(this.contractId, CONTEXT_KEY_PATH)]),
      { DST: "NEAR BLS12381G1_XMD:SHA-256_SSWU_RO_" },
    ) as unknown as InstanceType<typeof G1>;
    const y = bls.fields.Fr.fromBytes(bls.utils.randomSecretKey());
    const encode = (point: InstanceType<typeof G1>) =>
      `bls12381g1:${base58.encode(point.toBytes(true))}`;
    return {
      big_y: encode(G1.BASE.multiply(y)),
      big_c: encode(hashed.multiply(this.mpcSecret).add(app.multiply(y))),
    };
  }

  async mpcPublicKey(_source: KeySource): Promise<string> {
    return `bls12381g2:${base58.encode(bls.G2.Point.BASE.multiply(this.mpcSecret).toBytes(true))}`;
  }

  async uploadFastfs(args: Uint8Array): Promise<string> {
    const digest = createHash("sha256").update(args).update(String(this.uploads.size)).digest();
    const txHash = base58.encode(digest);
    this.uploads.set(txHash, Uint8Array.from(args));
    return txHash;
  }

  #kat(tokenId: string): KatView {
    const kat = this.kats.get(tokenId);
    if (!kat) {
      throw new Error("Kat not found");
    }
    return kat;
  }
}

/** Replies "reply N" and records every prompt it was given. */
export class FakeInference implements Inference {
  readonly calls: ChatMessage[][] = [];
  down = false;
  /** Used once in place of the next "reply N". */
  nextReply: string | null = null;
  /** Runs while the model is "thinking", before the reply is returned. */
  whileThinking: (() => void) | null = null;
  /** What the model writes when asked to update a kat's character and memory. */
  evolveTo: { character: string; memory: string } | null = null;

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    if (this.down) {
      throw new InferenceError("model offline");
    }
    this.calls.push(messages.map((message) => ({ ...message })));
    const n = this.calls.length;
    this.whileThinking?.();
    const updating = messages[0]?.content.includes("CHARACTER:") ?? false;
    const reply =
      this.nextReply ??
      (updating && this.evolveTo
        ? `CHARACTER:\n${this.evolveTo.character}\nMEMORY:\n${this.evolveTo.memory}`
        : `reply ${n}`);
    this.nextReply = null;
    return {
      reply,
      verification: {
        chat_id: `chat-${n}`,
        model: "fake-model",
        request_hash: "aa",
        response_hash: "bb",
        signature: null,
      },
    };
  }
}
