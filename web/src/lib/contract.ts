import type { Near } from "near-kit";
import type { CollectionView } from "./launchpad.ts";

/** A kat as the contract's `get_kat` view returns it. */
export interface KatView {
  owner_id: string;
  context_hash: string | null;
  context_ref: string | null;
  context_version: string;
  balance: string;
  /** The key epoch its context is encrypted under; 0 before it has one. Absent on older contracts. */
  key_epoch?: number;
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

/** A token's loan, as `get_loan` shows it. Times are nanoseconds, amounts yoctoNEAR. */
export interface LoanView {
  token_id: string;
  status: "offered" | "active" | "over";
  lender_id: string;
  /** Null: offered to anyone. */
  borrower_id: string | null;
  duration_s: string | null;
  messages: number | null;
  sees_memory: boolean;
  learns: boolean;
  fee: string;
  started_at: string | null;
  ends_at: string | null;
}

/** What an owner chooses when lending a token. */
export interface LoanTerms {
  /** Null: anyone may take it. */
  borrowerId: string | null;
  /** Null: until ended. */
  durationSeconds: number | null;
  /** Null: no limit. */
  messages: number | null;
  seesMemory: boolean;
  learns: boolean;
  /** yoctoNEAR; 0 for a free loan. */
  fee: bigint;
}

/** Covers a loan record's storage; what isn't needed comes back. */
export const LOAN_STORAGE_DEPOSIT = 10n ** 22n;

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

  get id(): string {
    return this.#contractId;
  }

  /** The collection's public prompt, starter, supply and TEE requirement. */
  async getCollection(): Promise<CollectionView> {
    const collection = await this.#view<CollectionView>("get_collection", {});
    if (!collection) {
      throw new Error("The contract returned no collection");
    }
    return collection;
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

  /** An account's tokens with their context versions, which set how grown each one is drawn. */
  async tokensWithGrowthOf(accountId: string): Promise<Array<{ id: string; version: number }>> {
    const ids = await this.katsOf(accountId);
    return Promise.all(
      ids.map(async (id) => {
        // A failed read only costs the picture its growth, never the listing.
        const kat = await this.getKat(id).catch(() => null);
        return { id, version: Number(kat?.context_version ?? 1) };
      }),
    );
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

  /**
   * Hands the collection to another keeper. Admin only. The contract moves
   * to a new key epoch, so the old keeper can't read what is saved next.
   */
  async setKeeper(keeperId: string): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "set_keeper",
      { keeper_id: keeperId },
      { gas: "30 Tgas", attachedDeposit: yocto(1n) },
    );
  }

  /** Moves to a new key epoch without changing keeper. Admin only. */
  async rotateContextKey(): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "rotate_context_key",
      {},
      { gas: "30 Tgas", attachedDeposit: yocto(1n) },
    );
  }

  /** Moves the collection to another published version. Admin only. */
  async upgrade(codeHash: string): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "upgrade",
      { code_hash: codeHash },
      { gas: "150 Tgas", attachedDeposit: yocto(1n) },
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

  /** The token's loan; null when it has none, or the contract predates lending. */
  async getLoan(tokenId: string): Promise<LoanView | null> {
    try {
      return (await this.#view<LoanView | null>("get_loan", { token_id: tokenId })) ?? null;
    } catch (error) {
      if (/MethodNotFound|MethodResolveError|does not exist/i.test(String(error))) {
        return null;
      }
      throw error;
    }
  }

  /** Offers the token on loan, as its owner. */
  async lend(tokenId: string, terms: LoanTerms): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "lend",
      {
        token_id: tokenId,
        borrower_id: terms.borrowerId,
        duration_s: terms.durationSeconds === null ? null : String(terms.durationSeconds),
        messages: terms.messages,
        sees_memory: terms.seesMemory,
        learns: terms.learns,
        fee: terms.fee.toString(),
      },
      { gas: "30 Tgas", attachedDeposit: yocto(LOAN_STORAGE_DEPOSIT), waitUntil: "FINAL" },
    );
  }

  /** Takes a loan on offer, paying its fee (at least a yoctoNEAR). */
  async borrow(tokenId: string, fee: bigint): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "borrow",
      { token_id: tokenId },
      { gas: "30 Tgas", attachedDeposit: yocto(fee > 0n ? fee : 1n), waitUntil: "FINAL" },
    );
  }

  /** Ends a loan: the borrower giving it back, or the owner withdrawing or ending it. */
  async endLoan(tokenId: string): Promise<void> {
    await this.#near.call(
      this.#contractId,
      "end_loan",
      { token_id: tokenId },
      { gas: "30 Tgas", attachedDeposit: yocto(1n), waitUntil: "FINAL" },
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

  /** Whether the contract has verified a TDX quote proving this key runs in its TEE app. */
  async isKeeperKeyAttested(publicKey: string): Promise<boolean> {
    return (
      (await this.#view<boolean>("is_keeper_key_attested", { public_key: publicKey })) === true
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
