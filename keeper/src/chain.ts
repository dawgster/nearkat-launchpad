import { FunctionCallError, type Near } from "near-kit";
import type { KeySource } from "./ckd.ts";
import type { CollectionInfo } from "./collection.ts";
import type { KatView } from "./types.ts";

/** How the contract answered a `debit_batch` call. */
export type DebitResult =
  | { status: "applied" }
  | { status: "insufficient"; tokenId: string }
  | { status: "out_of_sequence"; lastApplied: number };

/** Everything the keeper needs from the NFT contract. */
export interface Chain {
  getKat(tokenId: string): Promise<KatView | null>;
  setContext(tokenId: string, hashB64: string, ref: string, version: number): Promise<void>;
  /**
   * Items are `[token_id, amount in yoctoNEAR]`; the batch applies as a whole
   * or not at all. Resolves once the contract has answered. Throws only when
   * the outcome is unknown, such as a network failure or timeout.
   */
  debitBatch(seq: number, items: Array<[string, string]>): Promise<DebitResult>;
  /** Sequence number of the last applied batch. */
  getDebitSeq(): Promise<number>;
  /** The account the contract accepts keeper calls from. */
  getKeeperId(): Promise<string>;
  /** The collection's public prompt, starter and TEE requirement. */
  getCollection(): Promise<CollectionInfo>;
  /** yoctoNEAR the contract holds for the keeper from inference charges. */
  getInferenceAccrued(): Promise<bigint>;
  /** Sends what the contract holds for the keeper to the keeper account. */
  withdrawInference(): Promise<void>;
  /** Whether the contract accepts this key as running inside the required TEE app. */
  isKeyAttested(publicKey: string): Promise<boolean>;
  /** Proves to the contract that this key runs inside the required TEE app. */
  registerKeeperKey(proof: KeyProof): Promise<void>;
  /** Has the collection fetch its context key from the MPC network, encrypted to `appPublicKey`. */
  requestContextKey(appPublicKey: string): Promise<{ big_y: string; big_c: string }>;
  /** The MPC network's public key for a CKD domain. */
  mpcPublicKey(source: KeySource): Promise<string>;
  /** Stores a FastFS file addressed to this collection; resolves to the transaction hash. */
  uploadFastfs(args: Uint8Array): Promise<string>;
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

export class NearChain implements Chain {
  readonly #near: Near;
  readonly #contractId: string;
  readonly #finality: "final" | "optimistic";

  constructor(near: Near, contractId: string, finality: "final" | "optimistic" = "final") {
    this.#near = near;
    this.#contractId = contractId;
    this.#finality = finality;
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

  async setContext(tokenId: string, hashB64: string, ref: string, version: number): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "set_context",
      { token_id: tokenId, context_hash: hashB64, context_ref: ref, version: String(version) },
      { gas: "30 Tgas" },
    );
  }

  async debitBatch(seq: number, items: Array<[string, string]>): Promise<DebitResult> {
    try {
      // Waiting for finality means a view taken after this returns sees the debit.
      await this.#near.call(
        this.#contractId,
        "debit_batch",
        { seq: String(seq), items },
        { gas: "100 Tgas", waitUntil: "FINAL" },
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
      key_source: view.key_source ?? null,
    };
  }

  async getInferenceAccrued(): Promise<bigint> {
    return BigInt((await this.#config()).inference_accrued ?? "0");
  }

  async withdrawInference(): Promise<void> {
    await this.#near.call(this.#contractId, "withdraw_inference", {}, { gas: "30 Tgas" });
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
    });
  }

  async requestContextKey(appPublicKey: string): Promise<{ big_y: string; big_c: string }> {
    // The MPC network answers a few blocks later; the transaction's result is its answer.
    const outcome = (await this.#near.call(
      this.#contractId,
      "request_context_key",
      { app_public_key: appPublicKey },
      { gas: "300 Tgas", waitUntil: "FINAL" },
    )) as unknown as { status?: { SuccessValue?: string } };
    const value = outcome.status?.SuccessValue;
    if (!value) {
      throw new Error(`The MPC network gave no context key: ${JSON.stringify(outcome.status)}`);
    }
    const answer = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as {
      big_y?: string;
      big_c?: string;
    };
    if (typeof answer.big_y !== "string" || typeof answer.big_c !== "string") {
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
      .transaction(this.#signerId())
      .functionCall(this.#contractId, "__fastdata_fastfs", args, { gas: "10 Tgas" })
      .send({ waitUntil: "FINAL" })) as unknown as { transaction_outcome: { id: string } };
    return outcome.transaction_outcome.id;
  }

  #signerId(): string {
    const signer = (this.#near as unknown as { defaultSignerId?: string }).defaultSignerId;
    if (!signer) {
      throw new Error("The keeper has no signer for FastFS uploads");
    }
    return signer;
  }

  async #config(): Promise<{ keeper_id: string; debit_seq: string; inference_accrued?: string }> {
    const config = await this.#near.view<{
      keeper_id: string;
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
  return async (txHash: string, sender: string): Promise<Uint8Array> => {
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
    const args = body.result?.transaction?.actions?.[0]?.FunctionCall?.args;
    if (!args) {
      throw new Error(`Transaction ${txHash} not found: ${JSON.stringify(body.error ?? body)}`);
    }
    return Buffer.from(args, "base64");
  };
}
