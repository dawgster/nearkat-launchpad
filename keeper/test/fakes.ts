import { createHash } from "node:crypto";
import { base58 } from "@scure/base";
import {
  type Chain,
  type ContextSave,
  type DebitResult,
  KeyEpochChanged,
  type KeyProof,
  type SampleView,
} from "../src/chain.ts";
import { contextKeyPath, type KeySource, MpcKeyring, sampleKeyPath } from "../src/ckd.ts";
import { type CollectionInfo, DEFAULT_COLLECTION } from "../src/collection.ts";
import { InferenceError } from "../src/errors.ts";
import type { ChatResult, Inference, Tool } from "../src/inference.ts";
import type { LoanView } from "../src/loans.ts";
import type { ChatMessage, KatView } from "../src/types.ts";
import { PaymentRefused, type WalletView } from "../src/wallet.ts";
import { mpcAnswer, mpcPublicKeyOf } from "./mpc.ts";

export const NEAR = 10n ** 24n;

export const KEY_SOURCE: KeySource = { mpc_contract_id: "v1.signer", domain_id: 2 };

/** The original collection, as its contract publishes it. */
export const FAKE_COLLECTION: CollectionInfo = {
  ...DEFAULT_COLLECTION,
  tee: null,
  key_source: KEY_SOURCE,
  key_epoch: 1,
};

const keyrings = new WeakMap<FakeChain, MpcKeyring>();

/** The keyring for a fake chain, fetching keys from its simulated MPC network. One per chain. */
export function keyringFor(chain: FakeChain): MpcKeyring {
  let keyring = keyrings.get(chain);
  if (!keyring) {
    keyring = new MpcKeyring(chain.contractId, chain.collection.key_source, chain);
    keyrings.set(chain, keyring);
  }
  return keyring;
}

/** In-memory stand-in for the contract, enforcing the same rules. */
export class FakeChain implements Chain {
  readonly kats = new Map<string, KatView>();
  /** Every applied batch, as `[seq, items]`. */
  readonly debits: Array<[number, Array<[string, string]>]> = [];
  keeperId = "keeper.near";
  collection: CollectionInfo = FAKE_COLLECTION;
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
  readonly uploads = new Map<string, Uint8Array[]>();
  /** Loans by token, as the contract shows them. */
  readonly loans = new Map<string, LoanView>();

  /** Lends a token as its owner would; the loan is active from now unless said otherwise. */
  lend(tokenId: string, borrower: string, loan: Partial<LoanView> = {}): LoanView {
    const kat = this.kats.get(tokenId);
    const view: LoanView = {
      token_id: tokenId,
      status: "active",
      lender_id: kat?.owner_id ?? "alice.near",
      borrower_id: borrower,
      duration_s: null,
      messages: null,
      sees_memory: false,
      learns: false,
      fee: "0",
      started_at: "1",
      ends_at: null,
      ...loan,
    };
    this.loans.set(tokenId, view);
    return view;
  }

  async getLoan(tokenId: string): Promise<LoanView | null> {
    return this.loans.get(tokenId) ?? null;
  }

  /** Token 1's wallet as the contract shows it; null without wallets. */
  wallet: WalletView | null = null;
  /** yoctoNEAR in the wallet's account; null while it isn't open. */
  walletBalance: bigint | null = null;
  /** Payments the wallet made. */
  readonly walletSends: Array<{ receiverId: string; amount: bigint; memo: string }> = [];
  /** "failed": the next transfer doesn't go through; "unknown": the call times out. */
  walletSendFailure: "failed" | "unknown" | null = null;

  /** Gives token 1 a wallet whose owner lets the mind send `max` at a time and `daily` a day. */
  allowWallet(daily: bigint, max: bigint, balance: bigint | null = 10n ** 24n, open = true): void {
    this.wallet = {
      account_id: "1.nearkat.testnet",
      open,
      daily_allowance: daily.toString(),
      max_payment: max.toString(),
      spent_today: "0",
      payments: 0,
      last_payment: null,
    };
    this.walletBalance = open ? balance : null;
  }

  mint(tokenId: string, owner: string, balance: bigint): void {
    this.kats.set(tokenId, {
      owner_id: owner,
      context_hash: null,
      context_ref: null,
      context_version: "0",
      balance: balance.toString(),
      key_epoch: 0,
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

  /** Moves to a new key epoch, as changing keeper or `rotate_context_key` does. */
  rotate(): void {
    this.collection = { ...this.collection, key_epoch: this.collection.key_epoch + 1 };
  }

  async setContext({ tokenId, hashB64, ref, version, keyEpoch }: ContextSave): Promise<void> {
    if (this.failSetContext > 0) {
      this.failSetContext -= 1;
      throw new Error("RPC unavailable");
    }
    if (keyEpoch !== this.collection.key_epoch) {
      throw new KeyEpochChanged(this.collection.key_epoch);
    }
    const kat = this.#kat(tokenId);
    if (version !== Number(kat.context_version) + 1) {
      throw new Error(`Version must be ${Number(kat.context_version) + 1}`);
    }
    this.#stale.set(tokenId, { ...kat });
    kat.context_hash = hashB64;
    kat.context_ref = ref;
    kat.context_version = String(version);
    kat.key_epoch = keyEpoch;
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

  async getKeyEpoch(): Promise<number> {
    return this.collection.key_epoch;
  }

  async requestContextKey(
    appPublicKey: string,
    keyEpoch: number,
  ): Promise<{ big_y: string; big_c: string }> {
    this.ckdRequests += 1;
    if (this.ckdFailure) {
      throw new Error(this.ckdFailure);
    }
    if (keyEpoch < 0 || keyEpoch > this.collection.key_epoch) {
      throw new Error(`key_epoch must be at most ${this.collection.key_epoch}`);
    }
    // What the MPC network computes: K = msk·H(pk ‖ app_id), ElGamal-encrypted to the app key.
    return mpcAnswer(this.mpcSecret, this.contractId, contextKeyPath(keyEpoch), appPublicKey);
  }

  async mpcPublicKey(_source: KeySource): Promise<string> {
    return mpcPublicKeyOf(this.mpcSecret);
  }

  /** Samples as `set_samples` recorded them. */
  readonly samples = new Map<string, SampleView>();
  /** Every `request_ingest_keys` call's token ids. */
  readonly ingestRequests: string[][] = [];
  /** Tokens whose key the MPC network won't give. */
  readonly noSampleKey = new Set<string>();
  /** Calls to finish_minting. */
  finishMintingCalls = 0;
  adminId = "admin.near";

  #mpcAnswer(path: string, appPublicKey: string): { big_y: string; big_c: string } {
    return mpcAnswer(this.mpcSecret, this.contractId, path, appPublicKey);
  }

  async requestIngestKeys(
    tokenIds: string[],
    appPublicKey: string,
  ): Promise<Array<{ big_y: string; big_c: string } | null>> {
    this.ingestRequests.push(tokenIds);
    if (this.ckdFailure) {
      throw new Error(this.ckdFailure);
    }
    if (tokenIds.length > 10) {
      throw new Error("1 to 10 samples per call");
    }
    return tokenIds.map((id) =>
      this.noSampleKey.has(id) || this.samples.get(id)?.sample_hash
        ? null
        : this.#mpcAnswer(sampleKeyPath(id), appPublicKey),
    );
  }

  async requestSampleKeys(
    tokenIds: string[],
    appPublicKey: string,
  ): Promise<Array<{ big_y: string; big_c: string } | null>> {
    return tokenIds.map((id) =>
      this.samples.get(id)?.sample_hash ? this.#mpcAnswer(sampleKeyPath(id), appPublicKey) : null,
    );
  }

  async setSamples(items: Array<[string, string, string]>): Promise<void> {
    if (items.length < 1 || items.length > 50) {
      throw new Error("1 to 50 samples per call");
    }
    for (const [id, hash, ref] of items) {
      if (Buffer.from(hash, "base64").length !== 32) {
        throw new Error("sample hash must be 32 bytes");
      }
      const sample = this.samples.get(id);
      if (!sample) {
        throw new Error(`No sample ${id}`);
      }
      this.samples.set(id, { ...sample, sample_hash: hash, sample_ref: ref });
    }
  }

  async getSample(tokenId: string): Promise<SampleView | null> {
    return this.samples.get(tokenId) ?? null;
  }

  async getDatasetInfo(): Promise<{ classes: string[] } | null> {
    const kind = this.collection.kind;
    return kind && typeof kind === "object" ? { classes: kind.Dataset.classes } : null;
  }

  async getSupply(): Promise<{ minted: number; max_supply: number | null }> {
    return { minted: this.collection.minted ?? 0, max_supply: this.collection.max_supply ?? null };
  }

  async getAdminId(): Promise<string> {
    return this.adminId;
  }

  async finishMinting(): Promise<void> {
    this.finishMintingCalls += 1;
  }

  async uploadFastfsMany(argsList: Uint8Array[]): Promise<string> {
    if (argsList.length < 1 || argsList.length > 20) {
      throw new Error("1 to 20 FastFS files per transaction");
    }
    const digest = createHash("sha256");
    for (const args of argsList) {
      digest.update(args);
    }
    const txHash = base58.encode(digest.update(String(this.uploads.size)).digest());
    this.uploads.set(
      txHash,
      argsList.map((a) => Uint8Array.from(a)),
    );
    return txHash;
  }

  async uploadFastfs(args: Uint8Array): Promise<string> {
    const digest = createHash("sha256").update(args).update(String(this.uploads.size)).digest();
    const txHash = base58.encode(digest);
    this.uploads.set(txHash, [Uint8Array.from(args)]);
    return txHash;
  }

  async getWallet(tokenId: string): Promise<WalletView | null> {
    return tokenId === "1" ? this.wallet : null;
  }

  async accountBalance(_accountId: string): Promise<bigint | null> {
    return this.walletBalance;
  }

  async walletSend(
    _tokenId: string,
    receiverId: string,
    amount: bigint,
    memo: string,
  ): Promise<{ sent: boolean; hash: string }> {
    // The contract's rules, as it applies them.
    const wallet = this.wallet;
    if (!wallet?.open) {
      throw new PaymentRefused("This token's wallet isn't open");
    }
    if (BigInt(wallet.daily_allowance) === 0n) {
      throw new PaymentRefused("The owner hasn't let this token's mind spend");
    }
    if (amount > BigInt(wallet.max_payment)) {
      throw new PaymentRefused("That's more than the owner lets the mind send at once");
    }
    const spent = BigInt(wallet.spent_today) + amount;
    if (spent > BigInt(wallet.daily_allowance)) {
      throw new PaymentRefused("That's more than the owner lets the mind send today");
    }
    if (this.walletSendFailure === "unknown") {
      throw new Error("RPC timed out");
    }
    const hash = base58.encode(
      createHash("sha256").update(`${receiverId}${amount}${wallet.payments}`).digest(),
    );
    if (this.walletSendFailure === "failed") {
      return { sent: false, hash };
    }
    wallet.spent_today = spent.toString();
    wallet.payments += 1;
    wallet.last_payment = {
      receiver_id: receiverId,
      amount: amount.toString(),
      by_mind: true,
      memo,
      at: "0",
    };
    this.walletBalance = (this.walletBalance ?? 0n) - amount;
    this.walletSends.push({ receiverId, amount, memo });
    return { sent: true, hash };
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
  /** The tools offered with each call. */
  readonly tools: Array<string[]> = [];
  /** Used once, when the pay tool is offered: the model calls it with these arguments. */
  nextPay: Array<Record<string, unknown> | string> | null = null;
  /** Fails the call after the next tool call, as if the model went down mid-turn. */
  downAfterTool = false;

  async chat(messages: ChatMessage[], tools?: Tool[]): Promise<ChatResult> {
    if (this.down) {
      throw new InferenceError("model offline");
    }
    this.calls.push(messages.map((message) => ({ ...message })));
    this.tools.push(tools?.map((tool) => tool.function.name) ?? []);
    if (this.nextPay && tools?.some((tool) => tool.function.name === "pay")) {
      const calls = this.nextPay;
      this.nextPay = null;
      if (this.downAfterTool) {
        this.down = true;
      }
      return {
        reply: "",
        toolCalls: calls.map((args, i) => ({
          id: `call-${i}`,
          type: "function" as const,
          function: {
            name: "pay",
            arguments: typeof args === "string" ? args : JSON.stringify(args),
          },
        })),
        verification: {
          chat_id: `chat-${this.calls.length}`,
          model: "fake-model",
          request_hash: "aa",
          response_hash: "bb",
          signature: null,
        },
      };
    }
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
      toolCalls: [],
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
