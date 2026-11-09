import { type CallOptions, FunctionCallError, type Near } from "near-kit";
import type { KeyProof, SampleView } from "../../keeper/src/chain.ts";
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

/** What the training app needs from the dataset collections it trains on. */
export interface TrainerChain {
  /** The dataset's classes (null for a character collection) and where its keys come from. */
  getCollection(contract: string): Promise<{ classes: string[] | null; key_source: KeySource }>;
  getLoan(contract: string, id: string): Promise<LoanView | null>;
  getLoanTraining(contract: string, id: string): Promise<LoanTraining | null>;
  getSample(contract: string, id: string): Promise<SampleView | null>;
  /** Has the collection fetch the samples' keys from the MPC network; at most 10. */
  requestSampleKeys(
    contract: string,
    ids: string[],
    appPublicKey: string,
  ): Promise<Array<{ big_y: string; big_c: string } | null>>;
  /** Records a run on at most 50 samples and spends their rentals. */
  recordTraining(contract: string, run: TrainingRecord): Promise<void>;
  /** Every sample a run is recorded for, in the order recorded; empty if there is no such run. */
  getRunTokens(contract: string, runId: string): Promise<string[]>;
  isAppKeyRegistered(contract: string, publicKey: string): Promise<boolean>;
  registerAppKey(contract: string, proof: KeyProof & { label: string }): Promise<void>;
  /** The MPC network's public key for a CKD domain. */
  mpcPublicKey(source: KeySource): Promise<string>;
  /** Reads the collection's FastFS files. */
  fastfsStore(contract: string): FastfsStore;
}

/** The contract refused a call; the message is its panic. */
export class ContractRefusal extends Error {}

/** The most tokens one `get_run_tokens` page returns. */
const RUN_TOKENS_PAGE = 100;

/** What each `record_training` call attaches for storage; the contract refunds the rest. */
const RECORD_DEPOSIT = "0.1 NEAR";

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
    const view = await this.#view<{ kind?: CollectionKind; key_source: KeySource }>(
      contract,
      "get_collection",
      {},
    );
    if (!view) {
      throw new Error(`Contract ${contract} returned no collection`);
    }
    const kind = view.kind ?? "Character";
    return {
      classes: typeof kind === "object" ? kind.Dataset.classes : null,
      key_source: view.key_source,
    };
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
    )) as { status?: { SuccessValue?: string } };
    const value = outcome.status?.SuccessValue;
    if (!value) {
      throw new Error("The MPC network gave no sample keys");
    }
    const answer = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as unknown;
    if (!Array.isArray(answer) || answer.length !== ids.length) {
      throw new Error("The MPC network's answer is malformed");
    }
    return answer.map((item: { big_y?: unknown; big_c?: unknown } | null) =>
      item && typeof item.big_y === "string" && typeof item.big_c === "string"
        ? { big_y: item.big_y, big_c: item.big_c }
        : null,
    );
  }

  async recordTraining(contract: string, run: TrainingRecord): Promise<void> {
    await this.#call(contract, "record_training", run, {
      gas: "300 Tgas",
      attachedDeposit: RECORD_DEPOSIT,
    });
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

  async isAppKeyRegistered(contract: string, publicKey: string): Promise<boolean> {
    return (await this.#view<object>(contract, "get_app_key", { public_key: publicKey })) !== null;
  }

  async registerAppKey(contract: string, proof: KeyProof & { label: string }): Promise<void> {
    // Verifying a TDX quote on-chain costs about 170 Tgas.
    await this.#call(contract, "register_app_key", proof, { gas: "300 Tgas" });
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

  fastfsStore(contract: string): FastfsStore {
    const readOnly = () => Promise.reject(new Error("The training app does not upload"));
    return new FastfsStore({
      uploader: this.#signerId,
      receiver: contract,
      upload: readOnly,
      uploadMany: readOnly,
      transactionArgs: this.#transactionArgs,
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
