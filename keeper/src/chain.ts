import { FunctionCallError, type Near } from "near-kit";
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

  async #config(): Promise<{ keeper_id: string; debit_seq: string }> {
    const config = await this.#near.view<{ keeper_id: string; debit_seq: string }>(
      this.#contractId,
      "get_config",
      {},
      { finality: this.#finality },
    );
    if (!config) {
      throw new Error(`Contract ${this.#contractId} returned no config`);
    }
    return config;
  }
}
