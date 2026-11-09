import type { Near } from "near-kit";
import type { CollectionView } from "./launchpad.ts";
import type { ViewCache } from "./viewCache.ts";

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

/** What `lend_many` and `borrow_many` take at most per call. */
export const MAX_SAMPLES_PER_CALL = 50;

/**
 * Gas for one `lend_many` or `borrow_many` action of up to 50 samples. The
 * sandbox measures 25 and 30 Tgas for 50 (one lender); paying up to 50
 * lenders adds a transfer each, so 90 leaves a wide margin.
 */
export const BATCH_ACTION_GAS = "90 Tgas";
/** Actions per transaction: 3 × 90 Tgas fits the 300 Tgas one transaction may attach. */
export const ACTIONS_PER_TRANSACTION = 3;

/** What an owner chooses when listing samples for rent to training apps. */
export interface SampleTerms {
  /** Null: until it is used. */
  durationS: number | null;
  /** yoctoNEAR per rental. */
  fee: bigint;
  /** Registered training app ids, 1 to 8. */
  apps: string[];
}

/** A sample on offer to training apps. */
export interface Offer {
  tokenId: string;
  fee: bigint;
  lender: string;
  apps: string[];
}

/** A sample's training record: who may use it, who did, and whether the one use is spent. */
export interface LoanTraining {
  apps: string[];
  app_id: string | null;
  spent: boolean;
}

/** Samples an account has rented for one training app and not yet used. */
export interface Rental {
  appId: string;
  tokenIds: string[];
}

export interface SampleView {
  owner_id: string;
  sample_hash: string | null;
  sample_ref: string | null;
  runs: number;
}

export interface RunView {
  run_id: string;
  app_id: string;
  renter_id: string;
  model_sha256: string;
  accuracy_bps: number;
  token_count: number;
  recorded_at: string;
}

export interface AppKeyView {
  app_id: string;
  label: string;
  seal_public_key: string;
  attested_at: string;
  trusted_by_admin: boolean;
}

/**
 * Chooses `count` samples to rent for an app: cheapest first, but taking one
 * from each lender in turn so that several holders get paid.
 */
export function pickRentable(offers: Offer[], appId: string, count: number): string[] {
  const byLender = new Map<string, Offer[]>();
  for (const offer of offers) {
    if (offer.apps.includes(appId)) {
      byLender.set(offer.lender, [...(byLender.get(offer.lender) ?? []), offer]);
    }
  }
  const queues = [...byLender.values()].map((queue) =>
    queue.sort((a, b) => (a.fee < b.fee ? -1 : a.fee > b.fee ? 1 : 0)),
  );
  const picked: string[] = [];
  // Each round takes every lender's cheapest remaining offer, cheapest lender first.
  while (picked.length < count && queues.some((queue) => queue.length > 0)) {
    const round = queues
      .map((queue) => queue.shift())
      .filter((offer): offer is Offer => offer !== undefined)
      .sort((a, b) => (a.fee < b.fee ? -1 : a.fee > b.fee ? 1 : 0));
    for (const offer of round) {
      if (picked.length < count) {
        picked.push(offer.tokenId);
      }
    }
  }
  return picked;
}

const chunked = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

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

/** Views a page's scans repeat: cached by a reader that has a `ViewCache`. */
const SCAN_VIEWS = new Set([
  "nft_tokens",
  "nft_tokens_for_owner",
  "get_loan",
  "get_loan_training",
  "training_apps",
]);

export class KatContract {
  readonly #near: Near;
  readonly #contractId: string;
  readonly #views: ViewCache | null;

  /**
   * `views`: share a page's view limiter and cache. Without it every view
   * goes to the chain at once.
   */
  constructor(near: Near, contractId: string, options: { views?: ViewCache } = {}) {
    this.#near = near;
    this.#contractId = contractId;
    this.#views = options.views ?? null;
  }

  /** Forgets cached views, so what follows a transaction is read afresh. */
  forget(): void {
    this.#views?.clear();
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

  /**
   * Lists samples for rent to training apps: one `lend_many` action per 50,
   * up to three actions a transaction (one wallet prompt for 150). Each
   * action attaches its own samples' storage. Returns how many were listed.
   */
  async lendMany(signerId: string, tokenIds: string[], terms: SampleTerms): Promise<number> {
    return this.#batches(
      signerId,
      "lend_many",
      chunked(tokenIds, MAX_SAMPLES_PER_CALL).map((chunk) => ({
        args: {
          token_ids: chunk,
          duration_s: terms.durationS === null ? null : String(terms.durationS),
          fee: terms.fee.toString(),
          apps: terms.apps,
        },
        count: chunk.length,
        deposit: LOAN_STORAGE_DEPOSIT * BigInt(chunk.length),
      })),
    );
  }

  /**
   * Rents samples for an app: one `borrow_many` action per 50, up to three
   * actions a transaction (one wallet prompt for 150). Each action attaches
   * exactly its own samples' fees (`feeOf`). Returns how many were rented.
   */
  async borrowMany(
    signerId: string,
    tokenIds: string[],
    appId: string,
    feeOf: (tokenId: string) => bigint,
  ): Promise<number> {
    return this.#batches(
      signerId,
      "borrow_many",
      chunked(tokenIds, MAX_SAMPLES_PER_CALL).map((chunk) => {
        const fee = chunk.reduce((sum, id) => sum + feeOf(id), 0n);
        return {
          args: { token_ids: chunk, app_id: appId },
          count: chunk.length,
          deposit: fee > 0n ? fee : 1n,
        };
      }),
    );
  }

  /**
   * Sends calls of one method as the actions of as few transactions as fit
   * the gas a transaction may attach. A transaction's actions succeed or
   * fail together.
   */
  async #batches(
    signerId: string,
    method: string,
    calls: Array<{ args: object; count: number; deposit: bigint }>,
  ): Promise<number> {
    let done = 0;
    for (const group of chunked(calls, ACTIONS_PER_TRANSACTION)) {
      let tx = this.#near.transaction(signerId);
      for (const call of group) {
        tx = tx.functionCall(this.#contractId, method, call.args, {
          gas: BATCH_ACTION_GAS,
          attachedDeposit: yocto(call.deposit),
        });
      }
      await tx.send({ waitUntil: "FINAL" });
      done += group.reduce((sum, call) => sum + call.count, 0);
    }
    return done;
  }

  async getLoanTraining(tokenId: string): Promise<LoanTraining | null> {
    return (
      (await this.#view<LoanTraining | null>("get_loan_training", { token_id: tokenId })) ?? null
    );
  }

  async getSample(tokenId: string): Promise<SampleView | null> {
    return (await this.#view<SampleView | null>("get_sample", { token_id: tokenId })) ?? null;
  }

  async getSampleRuns(tokenId: string): Promise<string[]> {
    return (await this.#view<string[]>("get_sample_runs", { token_id: tokenId })) ?? [];
  }

  async getRun(runId: string): Promise<RunView | null> {
    return (await this.#view<RunView | null>("get_run", { run_id: runId })) ?? null;
  }

  /** `[app_id, label]` for every registered training app. Labels are the apps' own words. */
  async trainingApps(): Promise<Array<[string, string]>> {
    return (await this.#view<Array<[string, string]>>("training_apps", {})) ?? [];
  }

  async getAppKey(publicKey: string): Promise<AppKeyView | null> {
    return (await this.#view<AppKeyView | null>("get_app_key", { public_key: publicKey })) ?? null;
  }

  /**
   * The samples of a dataset (the first `max`, in pages) with their owners, and
   * those of them on offer to training apps.
   */
  async sampleOffers(max = 200): Promise<Offer[]> {
    const tokens = await this.#tokens(max);
    const offers: Offer[] = [];
    for (const batch of chunked(tokens, 25)) {
      const found = await Promise.all(
        batch.map(async (token): Promise<Offer | null> => {
          const loan = await this.getLoan(token.token_id);
          if (loan?.status !== "offered" || loan.lender_id !== token.owner_id) {
            return null;
          }
          const training = await this.getLoanTraining(token.token_id);
          if (!training || training.apps.length === 0) {
            return null;
          }
          return {
            tokenId: token.token_id,
            fee: BigInt(loan.fee),
            lender: token.owner_id,
            apps: training.apps,
          };
        }),
      );
      offers.push(...found.filter((offer): offer is Offer => offer !== null));
    }
    return offers;
  }

  /**
   * The account's rentals that a training app may still use, by app, among
   * the first `max` samples: active, borrowed by the account and not spent.
   */
  async rentalsOf(accountId: string, max = 200): Promise<Rental[]> {
    const tokens = await this.#tokens(max);
    const byApp = new Map<string, string[]>();
    for (const batch of chunked(tokens, 25)) {
      const found = await Promise.all(
        batch.map(async (token) => {
          const loan = await this.getLoan(token.token_id);
          if (loan?.status !== "active" || loan.borrower_id !== accountId) {
            return null;
          }
          const training = await this.getLoanTraining(token.token_id);
          return training?.app_id && !training.spent
            ? { appId: training.app_id, tokenId: token.token_id }
            : null;
        }),
      );
      for (const rental of found) {
        if (rental) {
          byApp.set(rental.appId, [...(byApp.get(rental.appId) ?? []), rental.tokenId]);
        }
      }
    }
    return [...byApp].map(([appId, tokenIds]) => ({ appId, tokenIds }));
  }

  /** The first `max` tokens with their owners, in pages. */
  async #tokens(max: number): Promise<Array<{ token_id: string; owner_id: string }>> {
    const tokens: Array<{ token_id: string; owner_id: string }> = [];
    while (tokens.length < max) {
      const page =
        (await this.#view<Array<{ token_id: string; owner_id: string }>>("nft_tokens", {
          from_index: String(tokens.length),
          limit: Math.min(100, max - tokens.length),
        })) ?? [];
      tokens.push(...page);
      if (page.length < 100) {
        break;
      }
    }
    return tokens;
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
    const load = () =>
      this.#near.view<T>(this.#contractId, method, args, { finality: "optimistic" });
    return this.#views
      ? this.#views.run(`${method}:${JSON.stringify(args)}`, load, SCAN_VIEWS.has(method))
      : load();
  }
}
