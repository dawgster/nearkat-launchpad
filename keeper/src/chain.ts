import type { Near } from "near-kit";
import type { KatView } from "./types.ts";

/** Everything the keeper needs from the NFT contract. */
export interface Chain {
  getKat(tokenId: string): Promise<KatView | null>;
  listTokenIds(fromIndex: number, limit: number): Promise<string[]>;
  setContext(tokenId: string, hashB64: string, ref: string, version: number): Promise<void>;
  /** Items are `[token_id, amount in yoctoNEAR]`. Fails as a whole. */
  debitBatch(items: Array<[string, string]>): Promise<void>;
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

  async listTokenIds(fromIndex: number, limit: number): Promise<string[]> {
    const tokens = await this.#near.view<Array<{ token_id: string }>>(
      this.#contractId,
      "nft_tokens",
      { from_index: String(fromIndex), limit },
      { finality: this.#finality },
    );
    return (tokens ?? []).map((token) => token.token_id);
  }

  async setContext(tokenId: string, hashB64: string, ref: string, version: number): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "set_context",
      { token_id: tokenId, context_hash: hashB64, context_ref: ref, version: String(version) },
      { gas: "30 Tgas" },
    );
  }

  async debitBatch(items: Array<[string, string]>): Promise<void> {
    await this.#near.call(this.#contractId, "debit_batch", { items }, { gas: "100 Tgas" });
  }
}
