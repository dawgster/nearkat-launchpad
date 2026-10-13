import type { Chain } from "./chain.ts";

/** Accumulates per-kat charges and settles them on-chain in batches. */
export class Meter {
  readonly #chain: Chain;
  readonly #pending = new Map<string, bigint>();

  constructor(chain: Chain) {
    this.#chain = chain;
  }

  charge(tokenId: string, amount: bigint): void {
    this.#pending.set(tokenId, this.pending(tokenId) + amount);
  }

  /** Charges recorded for this kat that are not yet settled on-chain. */
  pending(tokenId: string): bigint {
    return this.#pending.get(tokenId) ?? 0n;
  }

  /**
   * Settles everything pending. If the chain call fails, the charges stay
   * pending for the next flush. Charges made while the call is in flight are kept.
   */
  async flush(): Promise<void> {
    const snapshot = [...this.#pending].filter(([, amount]) => amount > 0n);
    if (snapshot.length === 0) {
      return;
    }
    await this.#chain.debitBatch(snapshot.map(([id, amount]) => [id, amount.toString()]));
    for (const [id, amount] of snapshot) {
      const left = this.pending(id) - amount;
      if (left > 0n) {
        this.#pending.set(id, left);
      } else {
        this.#pending.delete(id);
      }
    }
  }
}
