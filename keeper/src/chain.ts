import { FunctionCallError, type Near } from "near-kit";
import type { KeySource } from "./ckd.ts";
import type { CollectionInfo } from "./collection.ts";
import type { LoanView } from "./loans.ts";
import type { KatView } from "./types.ts";
import { PaymentRefused, type WalletChain, type WalletView } from "./wallet.ts";

/** How the contract answered a `debit_batch` call. */
export type DebitResult =
  | { status: "applied" }
  | { status: "insufficient"; tokenId: string }
  | { status: "out_of_sequence"; lastApplied: number };

/** What serving a collection's tokens needs: their records, contexts and charges. */
export interface TokenChain {
  getKat(tokenId: string): Promise<KatView | null>;
  /**
   * Records a token's new context. Throws `KeyEpochChanged` when the
   * collection has moved to another key epoch than the one it was saved under.
   */
  setContext(save: ContextSave): Promise<void>;
  /**
   * Items are `[token_id, amount in yoctoNEAR]`; the batch applies as a whole
   * or not at all. Resolves once the contract has answered. Throws only when
   * the outcome is unknown, such as a network failure or timeout.
   */
  debitBatch(seq: number, items: Array<[string, string]>): Promise<DebitResult>;
  /** Sequence number of the last applied batch. */
  getDebitSeq(): Promise<number>;
  /** The token's loan; null when it has none, or the contract predates lending. */
  getLoan?(tokenId: string): Promise<LoanView | null>;
}

export interface ContextSave {
  tokenId: string;
  hashB64: string;
  ref: string;
  version: number;
  keyEpoch: number;
}

/** What deciding whether to serve a collection, and running it, needs. */
export interface CollectionChain {
  /** The account the contract accepts keeper calls from. */
  getKeeperId(): Promise<string>;
  /** The collection's public prompt, starter, TEE requirement and key source. */
  getCollection(): Promise<CollectionInfo>;
  /** yoctoNEAR the contract holds for the keeper from inference charges. */
  getInferenceAccrued(): Promise<bigint>;
  /** Sends what the contract holds for the keeper to the keeper account. */
  withdrawInference(): Promise<void>;
  /** Whether the contract accepts this key as running inside the required TEE app. */
  isKeyAttested(publicKey: string): Promise<boolean>;
  /** Proves to the contract that this key runs inside the required TEE app. */
  registerKeeperKey(proof: KeyProof): Promise<void>;
}

/** The collection's way to NEAR's MPC network. */
export interface KeyChain {
  /** The epoch new contexts are saved under. */
  getKeyEpoch(): Promise<number>;
  /**
   * Has the collection fetch its context key for `keyEpoch` from the MPC
   * network, encrypted to `appPublicKey`.
   */
  requestContextKey(
    appPublicKey: string,
    keyEpoch: number,
  ): Promise<{ big_y: string; big_c: string }>;
  /** The MPC network's public key for a CKD domain. */
  mpcPublicKey(source: KeySource): Promise<string>;
}

/** Stores a FastFS file addressed to the collection; resolves to the transaction hash. */
export interface FastfsUploader {
  uploadFastfs(args: Uint8Array): Promise<string>;
  /** Several files in one transaction, at most 20; resolves to the transaction hash. */
  uploadFastfsMany(argsList: Uint8Array[]): Promise<string>;
}

/** What a dataset collection's ingest needs. */
export interface DatasetChain {
  /** Has the collection fetch the samples' keys from the MPC network. Keeper only; at most 10. */
  requestIngestKeys(
    tokenIds: string[],
    appPublicKey: string,
  ): Promise<Array<{ big_y: string; big_c: string } | null>>;
  /** Same, for a training app: samples that are sealed and rented. */
  requestSampleKeys?(
    tokenIds: string[],
    appPublicKey: string,
  ): Promise<Array<{ big_y: string; big_c: string } | null>>;
  /** Records sealed samples: `[token_id, sha256 base64, ref]`; at most 50. */
  setSamples(items: Array<[tokenId: string, sha256Base64: string, ref: string]>): Promise<void>;
  getSample(tokenId: string): Promise<SampleView | null>;
  /** The dataset's classes; null for a character collection. */
  getDatasetInfo(): Promise<{ classes: string[] } | null>;
  /** How many samples are minted, and how many the dataset has. */
  getSupply(): Promise<{ minted: number; max_supply: number | null }>;
  /** The collection's admin account. */
  getAdminId(): Promise<string>;
  /** Mints the samples still missing. Anyone may call it. */
  finishMinting(): Promise<void>;
}

export interface SampleView {
  owner_id: string;
  sample_hash: string | null;
  sample_ref: string | null;
  runs: number;
}

/** Everything the keeper needs from one collection contract. */
export type Chain = TokenChain &
  CollectionChain &
  KeyChain &
  FastfsUploader &
  WalletChain &
  DatasetChain;

/** The collection moved to another key epoch while a context was being saved. */
export class KeyEpochChanged extends Error {
  readonly current: number;

  constructor(current: number) {
    super(`The collection now saves contexts under key epoch ${current}`);
    this.current = current;
  }
}

/** What `register_keeper_key` takes. */
export interface KeyProof {
  public_key: string;
  /** X25519 sealing key, hex, proven together with the NEAR key. */
  seal_public_key: string;
  /** Hex. */
  quote: string;
  /** dcap-qvl's collateral as JSON, byte fields hex encoded. */
  collateral: string;
  /** dstack's event log JSON. */
  event_log: string;
}

/** The most `__fastdata_fastfs` actions one transaction carries: 20 × 10 Tgas fits a transaction's gas. */
export const MAX_FASTFS_ACTIONS = 20;

export class NearChain implements Chain {
  readonly #near: Near;
  readonly #contractId: string;
  readonly #finality: "final" | "optimistic";
  readonly #signerId: string;

  /** `signerId` is the keeper account, which signs every call. */
  constructor(
    near: Near,
    contractId: string,
    options: { signerId: string; finality?: "final" | "optimistic" },
  ) {
    this.#near = near;
    this.#contractId = contractId;
    this.#signerId = options.signerId;
    this.#finality = options.finality ?? "final";
  }

  async getKat(tokenId: string): Promise<KatView | null> {
    const kat = await this.#near.view<KatView | null>(
      this.#contractId,
      "get_kat",
      { token_id: tokenId },
      { finality: this.#finality },
    );
    return kat ?? null;
  }

  async getLoan(tokenId: string): Promise<LoanView | null> {
    try {
      const loan = await this.#near.view<LoanView | null>(
        this.#contractId,
        "get_loan",
        { token_id: tokenId },
        { finality: this.#finality },
      );
      return loan ?? null;
    } catch (error) {
      // Collections from before lending have no such method: nothing is lent.
      if (/MethodNotFound|MethodResolveError|not found|does not exist/i.test(String(error))) {
        return null;
      }
      throw error;
    }
  }

  async setContext(save: ContextSave): Promise<void> {
    try {
      await this.#near.call(
        this.#contractId,
        "set_context",
        {
          token_id: save.tokenId,
          context_hash: save.hashB64,
          context_ref: save.ref,
          version: String(save.version),
          key_epoch: save.keyEpoch,
        },
        { gas: "30 Tgas", signerId: this.#signerId },
      );
    } catch (error) {
      const panic = error instanceof FunctionCallError ? (error.panic ?? "") : "";
      const epoch = /saved under key epoch (\d+)/.exec(panic);
      if (epoch?.[1]) {
        throw new KeyEpochChanged(Number(epoch[1]));
      }
      throw error;
    }
  }

  async debitBatch(seq: number, items: Array<[string, string]>): Promise<DebitResult> {
    try {
      // Waiting for finality means a view taken after this returns sees the debit.
      await this.#near.call(
        this.#contractId,
        "debit_batch",
        { seq: String(seq), items },
        { gas: "100 Tgas", waitUntil: "FINAL", signerId: this.#signerId },
      );
      return { status: "applied" };
    } catch (error) {
      const panic = error instanceof FunctionCallError ? (error.panic ?? "") : "";
      const insufficient = /Insufficient balance for kat (\S+)/.exec(panic);
      if (insufficient?.[1]) {
        return { status: "insufficient", tokenId: insufficient[1] };
      }
      const sequence = /Batch \d+ is not next; last applied is (\d+)/.exec(panic);
      if (sequence?.[1]) {
        return { status: "out_of_sequence", lastApplied: Number(sequence[1]) };
      }
      throw error;
    }
  }

  async getDebitSeq(): Promise<number> {
    return Number((await this.#config()).debit_seq);
  }

  async getKeeperId(): Promise<string> {
    return (await this.#config()).keeper_id;
  }

  async getCollection(): Promise<CollectionInfo> {
    const view = await this.#near.view<CollectionInfo>(
      this.#contractId,
      "get_collection",
      {},
      { finality: this.#finality },
    );
    if (!view) {
      throw new Error(`Contract ${this.#contractId} returned no collection`);
    }
    return {
      name: view.name,
      prompt: view.prompt,
      starter: view.starter,
      tee: view.tee ?? null,
      terms: view.terms,
      sealed_prompt: view.sealed_prompt ?? null,
      key_source: view.key_source,
      key_epoch: view.key_epoch,
      wallet_code_hash: view.wallet_code_hash ?? null,
      history_import: view.history_import === true,
      kind: view.kind ?? "Character",
      class_counts: (view.class_counts ?? []).map(Number),
      minted: view.minted === undefined ? 0 : Number(view.minted),
      max_supply: view.max_supply == null ? null : Number(view.max_supply),
    };
  }

  async getWallet(tokenId: string): Promise<WalletView | null> {
    return (
      // The latest block: rules an owner just set apply at once. The
      // contract checks them again when it signs, so this can't overspend.
      (await this.#near.view<WalletView | null>(
        this.#contractId,
        "get_wallet",
        { token_id: tokenId },
        { finality: "optimistic" },
      )) ?? null
    );
  }

  async accountBalance(accountId: string): Promise<bigint | null> {
    try {
      return BigInt(
        (await this.#near.rpc.getAccount(accountId, { finality: "optimistic" })).amount,
      );
    } catch (error) {
      if (/does not exist|UNKNOWN_ACCOUNT|AccountDoesNotExist/i.test(String(error))) {
        return null;
      }
      throw error;
    }
  }

  async walletSend(
    tokenId: string,
    receiverId: string,
    amount: bigint,
    memo: string,
  ): Promise<{ sent: boolean; hash: string }> {
    let outcome: { status?: { SuccessValue?: string }; transaction: { hash: string } };
    try {
      outcome = (await this.#near.call(
        this.#contractId,
        "wallet_send",
        { token_id: tokenId, receiver_id: receiverId, amount: amount.toString(), memo },
        { gas: "60 Tgas", waitUntil: "FINAL", signerId: this.#signerId },
      )) as unknown as typeof outcome;
    } catch (error) {
      // The contract's refusal, such as the owner's limits, says why; any
      // other failure leaves the outcome unknown.
      if (error instanceof FunctionCallError) {
        throw new PaymentRefused(error.panic ?? error.message);
      }
      throw error;
    }
    const value = outcome.status?.SuccessValue;
    const sent = value ? JSON.parse(Buffer.from(value, "base64").toString("utf8")) === true : false;
    return { sent, hash: outcome.transaction.hash };
  }

  async getKeyEpoch(): Promise<number> {
    return (await this.getCollection()).key_epoch;
  }

  async getInferenceAccrued(): Promise<bigint> {
    return BigInt((await this.#config()).inference_accrued ?? "0");
  }

  async withdrawInference(): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "withdraw_inference",
      {},
      {
        gas: "30 Tgas",
        signerId: this.#signerId,
      },
    );
  }

  async isKeyAttested(publicKey: string): Promise<boolean> {
    return (
      (await this.#near.view<boolean>(
        this.#contractId,
        "is_keeper_key_attested",
        { public_key: publicKey },
        { finality: this.#finality },
      )) === true
    );
  }

  async registerKeeperKey(proof: KeyProof): Promise<void> {
    // Verifying a TDX quote on-chain costs about 170 Tgas.
    await this.#near.call(this.#contractId, "register_keeper_key", proof, {
      gas: "300 Tgas",
      waitUntil: "FINAL",
      signerId: this.#signerId,
    });
  }

  async requestContextKey(
    appPublicKey: string,
    keyEpoch: number,
  ): Promise<{ big_y: string; big_c: string }> {
    // The MPC network answers a few blocks later; the transaction's result is its answer.
    const outcome = (await this.#near.call(
      this.#contractId,
      "request_context_key",
      { app_public_key: appPublicKey, key_epoch: keyEpoch },
      { gas: "300 Tgas", waitUntil: "FINAL", signerId: this.#signerId },
    )) as unknown;
    const answer = mpcAnswerIn(outcome, "context key") as {
      big_y?: string;
      big_c?: string;
    } | null;
    if (typeof answer?.big_y !== "string" || typeof answer.big_c !== "string") {
      throw new Error("The MPC network's answer is malformed");
    }
    return { big_y: answer.big_y, big_c: answer.big_c };
  }

  async mpcPublicKey(source: KeySource): Promise<string> {
    const key = await this.#near.view<string>(
      source.mpc_contract_id,
      "public_key",
      { domain_id: source.domain_id },
      { finality: this.#finality },
    );
    if (typeof key !== "string") {
      throw new Error(`${source.mpc_contract_id} returned no public key`);
    }
    return key;
  }

  async uploadFastfs(args: Uint8Array): Promise<string> {
    const outcome = (await this.#near
      .transaction(this.#signerId)
      .functionCall(this.#contractId, "__fastdata_fastfs", args, { gas: "10 Tgas" })
      .send({ waitUntil: "FINAL" })) as unknown as { transaction_outcome: { id: string } };
    return outcome.transaction_outcome.id;
  }

  async uploadFastfsMany(argsList: Uint8Array[]): Promise<string> {
    if (argsList.length === 0 || argsList.length > MAX_FASTFS_ACTIONS) {
      throw new Error(`1 to ${MAX_FASTFS_ACTIONS} FastFS files per transaction`);
    }
    let tx = this.#near.transaction(this.#signerId);
    for (const args of argsList) {
      tx = tx.functionCall(this.#contractId, "__fastdata_fastfs", args, { gas: "10 Tgas" });
    }
    const outcome = (await tx.send({ waitUntil: "FINAL" })) as unknown as {
      transaction_outcome: { id: string };
    };
    return outcome.transaction_outcome.id;
  }

  async requestIngestKeys(
    tokenIds: string[],
    appPublicKey: string,
  ): Promise<Array<{ big_y: string; big_c: string } | null>> {
    return this.#sampleKeys("request_ingest_keys", tokenIds, appPublicKey);
  }

  async requestSampleKeys(
    tokenIds: string[],
    appPublicKey: string,
  ): Promise<Array<{ big_y: string; big_c: string } | null>> {
    return this.#sampleKeys("request_sample_keys", tokenIds, appPublicKey);
  }

  async #sampleKeys(
    method: string,
    tokenIds: string[],
    appPublicKey: string,
  ): Promise<Array<{ big_y: string; big_c: string } | null>> {
    // One MPC request per sample, answered a few blocks later.
    const outcome = (await this.#near.call(
      this.#contractId,
      method,
      { token_ids: tokenIds, app_public_key: appPublicKey },
      { gas: "300 Tgas", waitUntil: "FINAL", signerId: this.#signerId },
    )) as unknown;
    return sampleKeyAnswers(mpcAnswerIn(outcome, "sample keys"), tokenIds.length);
  }

  async setSamples(items: Array<[string, string, string]>): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "set_samples",
      { items },
      { gas: "100 Tgas", waitUntil: "FINAL", signerId: this.#signerId },
    );
  }

  async getSample(tokenId: string): Promise<SampleView | null> {
    return (
      (await this.#near.view<SampleView | null>(
        this.#contractId,
        "get_sample",
        { token_id: tokenId },
        { finality: this.#finality },
      )) ?? null
    );
  }

  async getDatasetInfo(): Promise<{ classes: string[] } | null> {
    const { kind } = await this.getCollection();
    return kind && typeof kind === "object" ? { classes: kind.Dataset.classes } : null;
  }

  async getSupply(): Promise<{ minted: number; max_supply: number | null }> {
    const { minted, max_supply } = await this.getCollection();
    return { minted: minted ?? 0, max_supply: max_supply ?? null };
  }

  async getAdminId(): Promise<string> {
    return (await this.#config()).admin_id;
  }

  async finishMinting(): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "finish_minting",
      {},
      { gas: "300 Tgas", waitUntil: "FINAL", signerId: this.#signerId },
    );
  }

  async #config(): Promise<{
    keeper_id: string;
    admin_id: string;
    debit_seq: string;
    inference_accrued?: string;
  }> {
    const config = await this.#near.view<{
      keeper_id: string;
      admin_id: string;
      debit_seq: string;
      inference_accrued?: string;
    }>(this.#contractId, "get_config", {}, { finality: this.#finality });
    if (!config) {
      throw new Error(`Contract ${this.#contractId} returned no config`);
    }
    return config;
  }
}

/**
 * Reads the arguments of a past function call from an archival RPC node, so
 * a FastFS file can be read back without any FastFS service.
 */
export function transactionArgsFrom(rpcUrl: string, fetchImpl: typeof fetch = fetch) {
  return async (txHash: string, sender: string): Promise<Uint8Array[]> => {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "nearkat",
        method: "tx",
        params: { tx_hash: txHash, sender_account_id: sender, wait_until: "NONE" },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json()) as {
      result?: { transaction?: { actions?: Array<{ FunctionCall?: { args?: string } }> } };
      error?: unknown;
    };
    const args = (body.result?.transaction?.actions ?? []).flatMap((action) =>
      action.FunctionCall?.args === undefined
        ? []
        : [Buffer.from(action.FunctionCall.args, "base64")],
    );
    if (args.length === 0) {
      throw new Error(`Transaction ${txHash} not found: ${JSON.stringify(body.error ?? body)}`);
    }
    return args;
  };
}

/**
 * The MPC network's answer to a call that waited on it: the JSON the
 * transaction finally returned. Says so plainly when there is none, as when
 * the call failed or its outcome ended at a receipt rather than a value.
 */
export function mpcAnswerIn(outcome: unknown, what: string): unknown {
  const status = (outcome as { status?: { SuccessValue?: unknown } } | null)?.status;
  const value = status?.SuccessValue;
  if (typeof value !== "string" || value === "") {
    throw new Error(
      `The MPC network gave no ${what}: the call returned ${JSON.stringify(status ?? null)}`,
    );
  }
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    throw new Error(`The MPC network's answer is malformed: the call did not return JSON`);
  }
}

/** One answer per asked-for sample, in order; null where the network gave none. */
export function sampleKeyAnswers(
  answer: unknown,
  count: number,
): Array<{ big_y: string; big_c: string } | null> {
  if (!Array.isArray(answer) || answer.length !== count) {
    throw new Error("The MPC network's answer is malformed");
  }
  return answer.map((item: { big_y?: unknown; big_c?: unknown } | null) =>
    item && typeof item.big_y === "string" && typeof item.big_c === "string"
      ? { big_y: item.big_y, big_c: item.big_c }
      : null,
  );
}
