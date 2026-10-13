import type { Chain } from "../src/chain.ts";
import { InferenceError } from "../src/errors.ts";
import type { ChatResult, Inference } from "../src/inference.ts";
import type { ChatMessage, KatView } from "../src/types.ts";

export const NEAR = 10n ** 24n;

/** In-memory stand-in for the contract, enforcing the same rules. */
export class FakeChain implements Chain {
  readonly kats = new Map<string, KatView>();
  readonly debits: Array<Array<[string, string]>> = [];
  failDebits = false;
  failSetContext = 0;
  /** When set, views keep returning the context as it was before the last save. */
  staleViews = false;
  #stale = new Map<string, KatView>();

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

  async listTokenIds(fromIndex: number, limit: number): Promise<string[]> {
    return [...this.kats.keys()].slice(fromIndex, fromIndex + limit);
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

  async debitBatch(items: Array<[string, string]>): Promise<void> {
    if (this.failDebits) {
      throw new Error("RPC unavailable");
    }
    for (const [tokenId, amount] of items) {
      if (BigInt(this.#kat(tokenId).balance) < BigInt(amount)) {
        throw new Error(`Insufficient balance for kat ${tokenId}`);
      }
    }
    for (const [tokenId, amount] of items) {
      const kat = this.#kat(tokenId);
      kat.balance = (BigInt(kat.balance) - BigInt(amount)).toString();
    }
    this.debits.push(items);
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

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    if (this.down) {
      throw new InferenceError("model offline");
    }
    this.calls.push(messages.map((message) => ({ ...message })));
    const n = this.calls.length;
    return {
      reply: `reply ${n}`,
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
