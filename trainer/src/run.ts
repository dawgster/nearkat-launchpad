import { createHash, randomBytes } from "node:crypto";
import { fetchSampleKeys, type KeySource } from "../../keeper/src/ckd.ts";
import { HttpError } from "../../keeper/src/errors.ts";
import { openSample } from "../../keeper/src/samples.ts";
import { ContractRefusal, type TrainerChain, type TrainingRecord } from "./chain.ts";
import { PythonError, type runPython } from "./python.ts";

export type Stage = "checking" | "keys" | "loading" | "training" | "recording" | "done" | "failed";

/** A run as the renter sees it. It never holds keys, images or Python's output. */
export interface RunState {
  id: string;
  contract: string;
  renter: string;
  tokenIds: string[];
  stage: Stage;
  epoch?: number;
  epochs?: number;
  accuracy?: number;
  modelSha256?: string;
  /** How many samples the run is recorded on-chain for; set when done. */
  recordedTokens?: number;
  /** The first `record_training` transaction, when its hash is known. */
  recordTx?: string;
  /** Set when only part of the run could be recorded; says why. */
  partial?: string;
  error?: string;
}

export class BadRequest extends HttpError {
  constructor(message: string) {
    super(400, "bad_request", message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message: string) {
    super(403, "forbidden", message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, "not_found", message);
  }
}

/** A failure whose message is safe to show the renter. */
export class RunFailure extends Error {}

export const MAX_RUN_SAMPLES = 200;
/** The most samples one `record_training` call takes. */
const RECORD_CHUNK = 50;
/** How many samples are checked, or fetched from FastFS, at once. */
const PARALLEL = 8;

/** What the renter is told when a stage fails for a reason not worth detailing. */
const STAGE_FAILURE: Record<Stage, string> = {
  checking: "Could not check the rentals",
  keys: "Could not get the samples' keys",
  loading: "Could not load the samples",
  training: "Training failed",
  recording: "Could not record the run",
  done: "Run failed",
  failed: "Run failed",
};

/** Runs `fn` on every item, at most `limit` at a time; results in order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface RunsOptions {
  /** The app id the contract knows this app by (the dstack app id from its event log). */
  appId: string;
  /** The NEAR key the app signs with. */
  appPublicKey: () => string;
  chain: TrainerChain;
  python: typeof runPython;
  /** The held-out images, `<dir>/<class>/*.jpg`. */
  heldoutDir: string;
  /** Registers the app's key with the collection if it isn't yet. */
  ensureRegistered(contract: string): Promise<void>;
  /** Sample keys asked for per call, 1 to 10. Defaults to 10. */
  keysPerCall?: number;
  /** Epochs per run; undefined leaves train.py's default. */
  epochs?: number;
  /** The clock, in ms; for tests. */
  now?: () => number;
}

/** The most runs kept at once; past this the oldest finished one is dropped. */
export const MAX_RUNS = 20;
/** How long a finished run's model is kept. */
export const MODEL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Training runs. Each checks the renter's rentals on-chain, gets the
 * samples' keys through the collection from NEAR's MPC network, decrypts
 * the samples from FastFS and streams them to Python, then records the run
 * on-chain and keeps the model for the renter. Keys and images live only in
 * the pipeline's local variables.
 */
export class Runs {
  readonly #o: RunsOptions;
  readonly #runs = new Map<string, RunState>();
  readonly #models = new Map<string, Buffer>();
  /** When each finished run finished, oldest first. */
  readonly #finishedAt = new Map<string, number>();
  /** `contract:token` of every sample in a run that has not finished. */
  readonly #busy = new Set<string>();

  constructor(o: RunsOptions) {
    this.#o = o;
  }

  /**
   * Checks the rentals and starts the run. Rejects with a `BadRequest`
   * naming the first sample that fails a check, before any key is asked
   * for; otherwise the run goes on in the background.
   */
  async start(contract: string, renter: string, tokenIds: string[]): Promise<RunState> {
    if (tokenIds.length < 1 || tokenIds.length > MAX_RUN_SAMPLES) {
      throw new BadRequest(`Train on 1 to ${MAX_RUN_SAMPLES} samples`);
    }
    const seen = new Set<string>();
    for (const id of tokenIds) {
      if (seen.has(id)) {
        throw new BadRequest(`Sample ${id}: listed twice`);
      }
      seen.add(id);
    }
    const slot = (id: string) => `${contract}:${id}`;
    const taken = tokenIds.find((id) => this.#busy.has(slot(id)));
    if (taken !== undefined) {
      throw new BadRequest(`Sample ${taken}: already in a run`);
    }
    // Held from here, so two starts at once can't both take a sample.
    for (const id of tokenIds) {
      this.#busy.add(slot(id));
    }
    const release = () => {
      for (const id of tokenIds) {
        this.#busy.delete(slot(id));
      }
    };
    let checked: { classes: string[]; keySource: KeySource; refs: Map<string, SampleRef> };
    try {
      checked = await this.#check(contract, renter, tokenIds);
    } catch (error) {
      release();
      throw error;
    }
    const state: RunState = {
      id: `run-${randomBytes(6).toString("hex")}`,
      contract,
      renter,
      tokenIds: [...tokenIds],
      stage: "keys",
    };
    this.#sweep();
    this.#runs.set(state.id, state);
    this.#evict();
    void this.#pipeline(state, checked).finally(release);
    return { ...state, tokenIds: [...state.tokenIds] };
  }

  /** Drops models older than their time to live. */
  #sweep(): void {
    const now = (this.#o.now ?? Date.now)();
    for (const [id, at] of this.#finishedAt) {
      if (now - at >= MODEL_TTL_MS) {
        this.#models.delete(id);
      }
    }
  }

  /** Keeps at most MAX_RUNS runs by dropping the oldest finished ones, with their models. */
  #evict(): void {
    for (const id of this.#finishedAt.keys()) {
      if (this.#runs.size <= MAX_RUNS) {
        return;
      }
      this.#runs.delete(id);
      this.#models.delete(id);
      this.#finishedAt.delete(id);
    }
  }

  #finish(id: string): void {
    this.#finishedAt.set(id, (this.#o.now ?? Date.now)());
    this.#evict();
  }

  get(id: string): RunState | undefined {
    const state = this.#runs.get(id);
    return state && { ...state, tokenIds: [...state.tokenIds] };
  }

  /** The trained model, for the renter only. */
  model(id: string, caller: string): Buffer {
    this.#sweep();
    const state = this.#runs.get(id);
    if (!state) {
      throw new NotFoundError("No such run");
    }
    if (caller !== state.renter) {
      throw new ForbiddenError("Only the renter may download the model");
    }
    const model = this.#models.get(id);
    if (!model) {
      throw new NotFoundError("The run has no model");
    }
    return Buffer.from(model);
  }

  /**
   * One `record_training` call. When the outcome is unknown, the chain is
   * asked whether it landed, and only if it didn't is the call tried again,
   * once; a refused or lost repeat is checked the same way.
   */
  async #record(contract: string, run: TrainingRecord): Promise<string | null> {
    try {
      return await this.#o.chain.recordTraining(contract, run);
    } catch (error) {
      if (error instanceof ContractRefusal) {
        throw error;
      }
      if (await this.#landed(contract, run)) {
        return null;
      }
    }
    try {
      return await this.#o.chain.recordTraining(contract, run);
    } catch (error) {
      if (!(await this.#landed(contract, run))) {
        throw error;
      }
      return null;
    }
  }

  /** Whether every sample of this call is already in the run's record on-chain. */
  async #landed(contract: string, run: TrainingRecord): Promise<boolean> {
    try {
      const recorded = new Set(await this.#o.chain.getRunTokens(contract, run.run_id));
      return run.token_ids.every((id) => recorded.has(id));
    } catch {
      return false; // Can't tell: treated as not landed.
    }
  }

  async #check(contract: string, renter: string, tokenIds: string[]) {
    const { chain, appId } = this.#o;
    const collection = await chain.getCollection(contract);
    if (!collection.classes) {
      throw new BadRequest(`${contract} is not a dataset`);
    }
    const problems = await mapLimit(tokenIds, PARALLEL, async (id) => {
      const [loan, training, sample] = await Promise.all([
        chain.getLoan(contract, id),
        chain.getLoanTraining(contract, id),
        chain.getSample(contract, id),
      ]);
      if (!loan || !training || loan.status.toLowerCase() === "offered") {
        return { id, problem: "not rented" };
      }
      if (loan.borrower_id !== renter) {
        return { id, problem: "rented by someone else" };
      }
      if (loan.status.toLowerCase() !== "active") {
        return { id, problem: "rental ended" };
      }
      if (training.spent) {
        return { id, problem: "already used" };
      }
      if (training.app_id !== appId) {
        return { id, problem: "rented for another training app" };
      }
      if (!sample?.sample_ref || !sample.sample_hash) {
        return { id, problem: "not sealed yet" };
      }
      return { id, ref: { ref: sample.sample_ref, hash: sample.sample_hash } };
    });
    const refs = new Map<string, SampleRef>();
    for (const result of problems) {
      if ("problem" in result) {
        throw new BadRequest(`Sample ${result.id}: ${result.problem}`);
      }
      refs.set(result.id, result.ref);
    }
    return { classes: collection.classes, keySource: collection.key_source, refs };
  }

  async #pipeline(
    state: RunState,
    checked: { classes: string[]; keySource: KeySource; refs: Map<string, SampleRef> },
  ): Promise<void> {
    const { chain } = this.#o;
    const { contract, renter, tokenIds } = state;
    try {
      await this.#o.ensureRegistered(contract);
      const mpcPublicKey = await chain.mpcPublicKey(checked.keySource);
      const keys = await fetchSampleKeys(
        contract,
        checked.keySource,
        (ids, appPublicKey) => chain.requestSampleKeys(contract, ids, appPublicKey),
        mpcPublicKey,
        tokenIds,
        this.#o.keysPerCall,
      ).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "";
        throw /^No key for sample \S+$/.test(message) ? new RunFailure(message) : error;
      });

      state.stage = "loading";
      const store = chain.fastfsStore(contract);
      const classes = new Set(checked.classes);
      const load = async (id: string) => {
        const { ref, hash } = checked.refs.get(id) as SampleRef;
        const blob = await store.get(ref);
        if (createHash("sha256").update(blob).digest("base64") !== hash) {
          throw new RunFailure(`Sample ${id} does not match its record`);
        }
        let doc: ReturnType<typeof openSample>;
        try {
          doc = openSample(keys.get(id) as Buffer, blob, id);
        } catch (error) {
          throw new RunFailure((error as Error).message);
        }
        if (!classes.has(doc.label)) {
          throw new RunFailure(`Sample ${id} has a label outside the dataset's classes`);
        }
        return { label: doc.label, jpeg: Buffer.from(doc.jpeg, "base64") };
      };
      // Samples are fetched a few ahead of Python, and decrypted only as it reads them.
      async function* samples() {
        const ahead: Array<Promise<{ label: string; jpeg: Buffer }>> = [];
        let next = 0;
        const fill = () => {
          while (ahead.length < PARALLEL && next < tokenIds.length) {
            const pending = load(tokenIds[next++] as string);
            pending.catch(() => {}); // Rethrown when its turn comes.
            ahead.push(pending);
          }
        };
        fill();
        while (ahead.length > 0) {
          const sample = await (ahead.shift() as Promise<{ label: string; jpeg: Buffer }>);
          fill();
          yield sample;
        }
      }

      const result = await this.#o.python({
        classes: checked.classes,
        heldoutDir: this.#o.heldoutDir,
        samples: samples(),
        ...(this.#o.epochs !== undefined && { epochs: this.#o.epochs }),
        onProgress: (p) => {
          if (p.stage === "loaded") {
            state.stage = "training";
          } else if (p.stage === "epoch") {
            state.stage = "training";
            state.epoch = p.epoch;
            state.epochs = p.epochs;
          }
        },
      });
      if (result.heldout === 0) {
        state.stage = "training";
        throw new RunFailure("No held-out set");
      }

      state.stage = "recording";
      const modelSha256 = createHash("sha256").update(result.model).digest("hex");
      const accuracyBps = Math.min(10_000, Math.max(0, Math.round(result.accuracy * 10_000)));
      // In order: once a chunk is final on-chain the renter has paid for the
      // model, so it is kept even if a later chunk can't be recorded.
      let recorded = 0;
      for (let i = 0; i < tokenIds.length; i += RECORD_CHUNK) {
        const chunk = tokenIds.slice(i, i + RECORD_CHUNK);
        try {
          const tx = await this.#record(contract, {
            run_id: state.id,
            renter_id: renter,
            token_ids: chunk,
            model_sha256: modelSha256,
            accuracy_bps: accuracyBps,
          });
          if (tx && state.recordTx === undefined) {
            state.recordTx = tx;
          }
        } catch (error) {
          const ended = /rental ended/.test(error instanceof Error ? error.message : String(error));
          if (recorded === 0) {
            if (ended) {
              throw new RunFailure("A rental ended before the run was recorded");
            }
            throw error;
          }
          console.error(`Run ${state.id}: recorded ${recorded} of ${tokenIds.length} samples`);
          state.partial = `Recorded ${recorded} of ${tokenIds.length} samples: ${
            ended
              ? "a rental ended before the rest were recorded"
              : "the rest could not be recorded"
          }`;
          break;
        }
        recorded += chunk.length;
      }
      state.recordedTokens = recorded;
      this.#models.set(state.id, result.model);
      state.accuracy = result.accuracy;
      state.modelSha256 = modelSha256;
      state.stage = "done";
      this.#finish(state.id);
    } catch (error) {
      const message =
        error instanceof RunFailure
          ? error.message
          : error instanceof PythonError
            ? "Training failed"
            : STAGE_FAILURE[state.stage];
      // Only the stage and the error's kind are logged: never what Python printed.
      console.error(
        `Run ${state.id} failed while ${state.stage}: ${message}`,
        error instanceof RunFailure || error instanceof PythonError ? "" : describe(error),
      );
      state.error = message;
      state.stage = "failed";
      this.#finish(state.id);
    }
  }
}

interface SampleRef {
  ref: string;
  /** SHA-256 of the sealed blob, base64, as the contract records it. */
  hash: string;
}

/** An unexpected error, for the log: chain and network errors carry no sample data. */
function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
}
