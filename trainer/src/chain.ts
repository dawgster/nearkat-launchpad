import { type CallOptions, FunctionCallError, type Near } from "near-kit";
import {
  type KeyProof,
  mpcAnswerIn,
  type SampleView,
  sampleKeyAnswers,
} from "../../keeper/src/chain.ts";
import type { KeySource } from "../../keeper/src/ckd.ts";
import type { CollectionKind } from "../../keeper/src/collection.ts";
import { FastfsStore } from "../../keeper/src/fastfs.ts";
import type { LoanView } from "../../keeper/src/loans.ts";

export type { KeyProof, LoanView, SampleView };

/** What a dataset loan allows: which training apps, and whether its one use is spent. */
export interface LoanTraining {
  apps: string[];
  app_id: string | null;
  spent: boolean;
}

/** What `record_training` takes. */
export interface TrainingRecord {
  run_id: string;
  renter_id: string;
  token_ids: string[];
  /** Hex. */
  model_sha256: string;
  /** Held-out accuracy in basis points, 0 to 10000. */
  accuracy_bps: number;
}

/** A run's model token, as `get_model` shows it. */
export interface ModelView {
  token_id: string;
  run_id: string;
  owner_id: string;
  /** The training app that trained it, the only one the collection gives its key. */
  app_id: string;
  renter_id: string;
  /** Hex, of the model file. */
  model_sha256: string;
  accuracy_bps: number;
  token_count: number;
  /** SHA-256 of the sealed blob, base64. */
  sealed_hash: string;
  sealed_ref: string;
  recorded_at: string;
}

/** What the training app needs from the dataset collections it trains on. */
export interface TrainerChain {
  /**
   * The dataset's classes (null for a character collection), where its keys
   * come from, and the launchpad it says launched it (null if none).
   */
  getCollection(contract: string): Promise<{
    classes: string[] | null;
    key_source: KeySource;
    factory_id: string | null;
  }>;
  /** Whether `launchpad` lists `contract` as a collection it launched, and live. */
  isLaunched(launchpad: string, contract: string): Promise<boolean>;
  getLoan(contract: string, id: string): Promise<LoanView | null>;
  getLoanTraining(contract: string, id: string): Promise<LoanTraining | null>;
  getSample(contract: string, id: string): Promise<SampleView | null>;
  /** Has the collection fetch the samples' keys from the MPC network; at most 10. */
  requestSampleKeys(
    contract: string,
    ids: string[],
    appPublicKey: string,
  ): Promise<Array<{ big_y: string; big_c: string } | null>>;
  /** Records a run on at most 50 samples and spends their rentals; the transaction's hash, if known. */
  recordTraining(contract: string, run: TrainingRecord): Promise<string | null>;
  /** Every sample a run is recorded for, in the order recorded; empty if there is no such run. */
  getRunTokens(contract: string, runId: string): Promise<string[]>;
  /**
   * Has the collection fetch the key of a run's model token from the MPC
   * network: one answer. Only for a run this app recorded.
   */
  requestModelKey(
    contract: string,
    runId: string,
    appPublicKey: string,
  ): Promise<Array<{ big_y: string; big_c: string } | null>>;
  /**
   * Mints a run's model token to its renter, with its sealed blob's SHA-256
   * (base64) and FastFS ref; the transaction's hash, if known.
   */
  mintModel(
    contract: string,
    runId: string,
    sealedHash: string,
    sealedRef: string,
  ): Promise<string | null>;
  /** A model token and its run; null for a sample or an unknown token. */
  getModel(contract: string, tokenId: string): Promise<ModelView | null>;
  /** The app a public key is registered to on the collection, or null if it isn't. */
  getAppKey(contract: string, publicKey: string): Promise<{ app_id: string } | null>;
  registerAppKey(contract: string, proof: KeyProof & { label: string }): Promise<void>;
  /** The MPC network's public key for a CKD domain. */
  mpcPublicKey(source: KeySource): Promise<string>;
  /** Reads the collection's FastFS files, and stores this app's own (sealed models). */
  fastfsStore(contract: string): FastfsStore;
}

/** The contract refused a call; the message is its panic. */
export class ContractRefusal extends Error {}

/**
 * Whether the contract refused because a sample's rental is over. NEAR
 * panics are text, so this matches the contract's own wording,
 * "Sample <id>: rental ended" (contract/src/lending.rs `rental_problem`).
 */
export function isRentalEnded(error: unknown): boolean {
  return error instanceof ContractRefusal && /\bSample \S+: rental ended\b/.test(error.message);
}

/** The most tokens one `get_run_tokens` page returns. */
const RUN_TOKENS_PAGE = 100;

/** What each `record_training` call attaches for storage; the contract refunds the rest. */
const RECORD_DEPOSIT = "0.1 NEAR";

/** What `mint_model` attaches for the token's storage (about 0.02 NEAR); the rest is refunded. */
const MINT_DEPOSIT = "0.1 NEAR";

/** The hash of the transaction a call was sent in, if the outcome names it. */
function txHashOf(outcome: unknown): string | null {
  const o = outcome as
    | { transaction?: { hash?: unknown }; transaction_outcome?: { id?: unknown } }
    | undefined;
  const hash = o?.transaction?.hash ?? o?.transaction_outcome?.id;
  return typeof hash === "string" ? hash : null;
}

/**
 * The training app's account on NEAR. It signs with a full-access key:
 * `record_training` takes a deposit, which a function-call key can't attach.
 */
export class NearTrainerChain implements TrainerChain {
  readonly #near: Near;
  readonly #signerId: string;
  readonly #transactionArgs: (txHash: string, sender: string) => Promise<Uint8Array[]>;
  readonly #gatewayUrl: ((uploader: string, receiver: string, path: string) => string) | null;
  readonly #finality: "final" | "optimistic";

  constructor(
    near: Near,
    options: {
      signerId: string;
      /** Reads a past transaction's call arguments, as `transactionArgsFrom` does. */
      transactionArgs: (txHash: string, sender: string) => Promise<Uint8Array[]>;
      gatewayUrl: ((uploader: string, receiver: string, path: string) => string) | null;
      finality?: "final" | "optimistic";
    },
  ) {
    this.#near = near;
    this.#signerId = options.signerId;
    this.#transactionArgs = options.transactionArgs;
    this.#gatewayUrl = options.gatewayUrl;
    this.#finality = options.finality ?? "final";
  }

  #view<T>(contract: string, method: string, args: object): Promise<T | null> {
    return this.#near
      .view<T>(contract, method, args, { finality: this.#finality })
      .then((value) => value ?? null);
  }

  async getCollection(contract: string) {
    const view = await this.#view<{
      kind?: CollectionKind;
      key_source: KeySource;
      factory_id?: string | null;
    }>(contract, "get_collection", {});
    if (!view) {
      throw new Error(`Contract ${contract} returned no collection`);
    }
    const kind = view.kind ?? "Character";
    return {
      classes: typeof kind === "object" ? kind.Dataset.classes : null,
      key_source: view.key_source,
      factory_id: view.factory_id ?? null,
    };
  }

  async isLaunched(launchpad: string, contract: string) {
    const entry = await this.#view<{ live?: boolean }>(launchpad, "get_collection", {
      account_id: contract,
    });
    return entry?.live === true;
  }

  getLoan(contract: string, id: string) {
    return this.#view<LoanView>(contract, "get_loan", { token_id: id });
  }

  getLoanTraining(contract: string, id: string) {
    return this.#view<LoanTraining>(contract, "get_loan_training", { token_id: id });
  }

  getSample(contract: string, id: string) {
    return this.#view<SampleView>(contract, "get_sample", { token_id: id });
  }

  async requestSampleKeys(contract: string, ids: string[], appPublicKey: string) {
    // One MPC request per sample, answered a few blocks later; each gets a share of the gas.
    const outcome = (await this.#call(
      contract,
      "request_sample_keys",
      { token_ids: ids, app_public_key: appPublicKey },
      { gas: "300 Tgas" },
    )) as unknown;
    return sampleKeyAnswers(mpcAnswerIn(outcome, "sample keys"), ids.length);
  }

  async recordTraining(contract: string, run: TrainingRecord): Promise<string | null> {
    return txHashOf(
      await this.#call(contract, "record_training", run, {
        gas: "300 Tgas",
        attachedDeposit: RECORD_DEPOSIT,
      }),
    );
  }

  async requestModelKey(contract: string, runId: string, appPublicKey: string) {
    const outcome = (await this.#call(
      contract,
      "request_model_key",
      { run_id: runId, app_public_key: appPublicKey },
      { gas: "300 Tgas" },
    )) as unknown;
    return sampleKeyAnswers(mpcAnswerIn(outcome, "model key"), 1);
  }

  async mintModel(
    contract: string,
    runId: string,
    sealedHash: string,
    sealedRef: string,
  ): Promise<string | null> {
    return txHashOf(
      await this.#call(
        contract,
        "mint_model",
        { run_id: runId, sealed_hash: sealedHash, sealed_ref: sealedRef },
        { gas: "100 Tgas", attachedDeposit: MINT_DEPOSIT },
      ),
    );
  }

  getModel(contract: string, tokenId: string) {
    return this.#view<ModelView>(contract, "get_model", { token_id: tokenId });
  }

  async getRunTokens(contract: string, runId: string): Promise<string[]> {
    const run = await this.#view<{ token_count: number }>(contract, "get_run", { run_id: runId });
    if (!run) {
      return [];
    }
    const tokens: string[] = [];
    while (tokens.length < run.token_count) {
      const page =
        (await this.#view<string[]>(contract, "get_run_tokens", {
          run_id: runId,
          from: tokens.length,
          limit: RUN_TOKENS_PAGE,
        })) ?? [];
      if (page.length === 0) {
        break;
      }
      tokens.push(...page);
    }
    return tokens;
  }

  getAppKey(contract: string, publicKey: string) {
    return this.#view<{ app_id: string }>(contract, "get_app_key", { public_key: publicKey });
  }

  async registerAppKey(contract: string, proof: KeyProof & { label: string }): Promise<void> {
    // Verifying a TDX quote on-chain costs about 170 Tgas; the deposit pays the key's storage.
    await this.#call(contract, "register_app_key", proof, {
      gas: "300 Tgas",
      attachedDeposit: "0.05 NEAR",
    });
  }

  async mpcPublicKey(source: KeySource): Promise<string> {
    const key = await this.#view<string>(source.mpc_contract_id, "public_key", {
      domain_id: source.domain_id,
    });
    if (typeof key !== "string") {
      throw new Error(`${source.mpc_contract_id} returned no public key`);
    }
    return key;
  }

  /**
   * The collection's FastFS files, for one run. One ingest transaction holds
   * up to 20 samples, so each transaction's arguments are fetched from the
   * archival node once and kept for the run (they are the sealed blobs, never
   * plaintext). A failed fetch is not kept. The app's own uploads (a run's
   * sealed model) go one file a transaction, from its own account.
   */
  fastfsStore(contract: string): FastfsStore {
    const upload = async (receiver: string, args: Uint8Array) => {
      const outcome = (await this.#near
        .transaction(this.#signerId)
        .functionCall(receiver, "__fastdata_fastfs", args, { gas: "10 Tgas" })
        .send({ waitUntil: "FINAL" })) as unknown;
      const hash = txHashOf(outcome);
      if (!hash) {
        throw new Error("The FastFS upload returned no transaction hash");
      }
      return hash;
    };
    const oneAtATime = () =>
      Promise.reject(new Error("The training app uploads one file a transaction"));
    const fetched = new Map<string, Promise<Uint8Array[]>>();
    const transactionArgs = (txHash: string, sender: string) => {
      const key = `${sender}:${txHash}`;
      let args = fetched.get(key);
      if (!args) {
        args = this.#transactionArgs(txHash, sender);
        fetched.set(key, args);
        args.catch(() => fetched.delete(key));
      }
      return args;
    };
    return new FastfsStore({
      uploader: this.#signerId,
      receiver: contract,
      upload,
      uploadMany: oneAtATime,
      transactionArgs,
      gatewayUrl: this.#gatewayUrl,
    });
  }

  async #call(
    contract: string,
    method: string,
    args: object,
    options: Pick<CallOptions, "gas" | "attachedDeposit">,
  ): Promise<unknown> {
    try {
      return await this.#near.call(contract, method, args as Record<string, unknown>, {
        ...options,
        waitUntil: "FINAL",
        signerId: this.#signerId,
      });
    } catch (error) {
      if (error instanceof FunctionCallError) {
        throw new ContractRefusal(error.panic ?? error.message);
      }
      throw error;
    }
  }
}
