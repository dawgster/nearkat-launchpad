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

  /** Mints a kat to the signer. `startingBalance` funds its first conversations. */
  async mint(mintPrice: bigint, startingBalance: bigint): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "mint",
      {},
      {
        gas: "30 Tgas",
        attachedDeposit: yocto(mintPrice + MINT_STORAGE_ALLOWANCE + startingBalance),
      },
    );
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

  /** Whether an account holds a given key as a full-access key. */
  async accountHoldsKey(accountId: string, publicKey: string): Promise<boolean> {
    const key = await this.#near.getAccessKey(accountId, publicKey);
    return key !== null && key.permission === "FullAccess";
  }

  // Optimistic finality: the interface should show a transaction's effect at once.
  #view<T>(method: string, args: object): Promise<T | undefined> {
    return this.#near.view<T>(this.#contractId, method, args, { finality: "optimistic" });
  }
}
