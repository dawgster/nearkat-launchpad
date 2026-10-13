import type { Near } from "near-kit";

/** A kat as the contract's `get_kat` view returns it. */
export interface KatView {
  owner_id: string;
  context_hash: string | null;
  context_ref: string | null;
  context_version: string;
  balance: string;
}

export interface ContractConfig {
  admin_id: string;
  keeper_id: string;
  treasury_id: string;
  mint_price: string;
}

/**
 * Storage the contract charges at mint, rounded up. The contract takes the
 * exact cost from the deposit and credits the rest to the kat's balance.
 */
export const MINT_STORAGE_ALLOWANCE = 2n * 10n ** 22n;

const yocto = (amount: bigint) => `${amount} yocto` as const;

/**
 * The value a contract method returned, taken from a transaction outcome.
 * Null when there is none or it cannot be read: wallets differ in what they
 * hand back, so callers must cope without it.
 */
export function returnValue<T>(outcome: unknown): T | null {
  const encoded = (outcome as { status?: { SuccessValue?: unknown } } | undefined)?.status
    ?.SuccessValue;
  if (typeof encoded !== "string" || encoded === "") {
    return null;
  }
  try {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

export class KatContract {
  readonly #near: Near;
  readonly #contractId: string;

  constructor(near: Near, contractId: string) {
    this.#near = near;
    this.#contractId = contractId;
  }

  async getKat(tokenId: string): Promise<KatView | null> {
    return (await this.#view<KatView | null>("get_kat", { token_id: tokenId })) ?? null;
  }

  async getConfig(): Promise<ContractConfig> {
    const config = await this.#view<ContractConfig>("get_config", {});
    if (!config) {
      throw new Error("The contract returned no configuration");
    }
    return config;
  }

  /** Token ids owned by an account, lowest number first. */
  async katsOf(accountId: string): Promise<string[]> {
    const tokens = await this.#view<Array<{ token_id: string }>>("nft_tokens_for_owner", {
      account_id: accountId,
      limit: 100,
    });
    return (tokens ?? []).map((token) => token.token_id).sort((a, b) => Number(a) - Number(b));
  }

  /**
   * Mints a kat to the signer. `startingBalance` funds its first
   * conversations. Returns the new token id, or null if the wallet did not
   * hand back the transaction's result.
   */
  async mint(mintPrice: bigint, startingBalance: bigint): Promise<string | null> {
    const outcome = await this.#near.call(
      this.#contractId,
      "mint",
      {},
      {
        gas: "30 Tgas",
        attachedDeposit: yocto(mintPrice + MINT_STORAGE_ALLOWANCE + startingBalance),
      },
    );
    return returnValue<{ token_id: string }>(outcome)?.token_id ?? null;
  }

  async fund(tokenId: string, amount: bigint): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "fund",
      { token_id: tokenId },
      { gas: "30 Tgas", attachedDeposit: yocto(amount) },
    );
  }

  async transfer(tokenId: string, receiverId: string): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "nft_transfer",
      { receiver_id: receiverId, token_id: tokenId },
      { gas: "30 Tgas", attachedDeposit: yocto(1n) },
    );
  }

  /** Whether an account exists. Throws if that cannot be looked up. */
  accountExists(accountId: string): Promise<boolean> {
    return this.#near.accountExists(accountId);
  }

  /**
   * Whether an account holds a given key as a full-access key. Throws if the
   * keys cannot be listed, so a failed lookup is never mistaken for "no".
   */
  async accountHoldsKey(accountId: string, publicKey: string): Promise<boolean> {
    const { keys } = await this.#near.getAccessKeys(accountId);
    return keys.some(
      (key) => key.public_key === publicKey && key.access_key.permission === "FullAccess",
    );
  }

  /**
   * Resolves once finalized blocks show at least this balance for the kat.
   * The keeper reads finalized blocks, so a top-up only counts for it then.
   */
  async waitForFinalBalance(tokenId: string, atLeast: bigint, attempts = 20): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const kat = await this.#near
        .view<KatView | null>(
          this.#contractId,
          "get_kat",
          { token_id: tokenId },
          { finality: "final" },
        )
        .catch(() => null);
      if (kat && BigInt(kat.balance) >= atLeast) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Optimistic finality: the interface should show a transaction's effect at once.
  #view<T>(method: string, args: object): Promise<T | undefined> {
    return this.#near.view<T>(this.#contractId, method, args, { finality: "optimistic" });
  }
}
