import { createHash, randomBytes } from "node:crypto";
import { fetchSampleKeys, type KeySource } from "../../keeper/src/ckd.ts";
import { HttpError } from "../../keeper/src/errors.ts";
import { openSample } from "../../keeper/src/samples.ts";
import { ContractRefusal, isRentalEnded, type TrainerChain, type TrainingRecord } from "./chain.ts";
import { classWithoutHeldout } from "./heldout.ts";
import { type Head, isModelToken, modelTokenId, openModel, sealModel } from "./model.ts";
import { assembleModel, PythonError, type runPython } from "./python.ts";

/** A run exists only once its rentals are checked, so it starts at "keys". */
export type Stage = "keys" | "loading" | "training" | "recording" | "minting" | "done" | "failed";

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
  /** The run's model token (`model-<run id>`), minted to the renter; set when done. */
  modelToken?: string;
  /** The `mint_model` transaction, when its hash is known. */
  mintTx?: string;
  /** Set instead of `modelToken` when the model could not be sealed and minted. */
  mintProblem?: string;
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

/** A model token's sealed blob, or the model rebuilt from it, is not what the chain records. */
export class ModelMismatch extends HttpError {
  constructor(message: string) {
    super(409, "model_mismatch", message);
  }
}

/** A failure whose message is safe to show the renter. */
export class RunFailure extends Error {}

/** The fewest samples a run trains on; train.py's MIN_SAMPLES matches. */
export const MIN_RUN_SAMPLES = 2;
export const MAX_RUN_SAMPLES = 200;
/** The most samples one `record_training` call takes. */
const RECORD_CHUNK = 50;
/** `request_sample_keys` calls in flight at once: each fans out to the MPC network. */
const KEY_CALLS_AT_ONCE = 5;
/** How many samples are checked, or fetched from FastFS, at once. */
const PARALLEL = 8;

/** What the renter is told when a stage fails for a reason not worth detailing. */
const STAGE_FAILURE: Record<Exclude<Stage, "done" | "failed">, string> = {
  keys: "Could not get the samples' keys",
  loading: "Could not load the samples",
  training: "Training failed",
  recording: "Could not record the run",
  minting: "Could not mint the model token",
};

/** What the renter is told when the model token could not be minted; the run still stands. */
const MINT_PROBLEM = "it could not be sealed and minted on-chain";
/** The most rebuilt models kept in memory for their owners (about 12 MB each). */
const MAX_OPENED_MODELS = 4;

const sha256Hex = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const sha256Base64 = (data: Uint8Array) => createHash("sha256").update(data).digest("base64");

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
  /**
   * The launchpad whose collections this app trains on. A collection must
   * say it came from it, and the launchpad must list it as live. Null: any
   * collection (local mode only).
   */
  launchpadId?: string | null;
  /** The app id the contract knows this app by (the dstack app id from its event log). */
  appId: string;
  chain: TrainerChain;
  python: typeof runPython;
  /** Rebuilds a model file from its head; `assembleModel` unless replaced, for tests. */
  assemble?: typeof assembleModel;
  /** The held-out images, `<dir>/<class>/*.jpg`; every class needs some. */
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
 *
 * The model also becomes a token: what the run learned is sealed under the
 * token's own key from the MPC network, stored on FastFS and minted to the
 * renter. `tokenModel` opens it again, for whoever owns the token by then.
 */
export class Runs {
  readonly #o: RunsOptions;
  readonly #runs = new Map<string, RunState>();
  readonly #models = new Map<string, Buffer>();
  /**
   * When each finished run finished, oldest first. An entry outlives its
   * model: it is also the order the run itself is evicted in, so it goes
   * with the run, and there are at most MAX_RUNS of them.
   */
  readonly #finishedAt = new Map<string, number>();
  /** `contract:token` of every sample in a run that has not finished. */
  readonly #busy = new Set<string>();
  /** Models rebuilt from their tokens, newest last: `contract:token` to the file. */
  readonly #opened = new Map<string, Buffer>();
  /** Models being rebuilt now, so two requests for one token share the work. */
  readonly #opening = new Map<string, Promise<Buffer>>();

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
    // Dropped on time even if no request comes along to sweep it.
    setTimeout(() => this.#models.delete(id), MODEL_TTL_MS).unref();
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
   * The model a token stands for, for the token's owner only: read from the
   * chain as of now, so it follows the token when it changes hands. The
   * sealed head is fetched from FastFS, opened with the token's key and
   * rebuilt into the model file, which must have the hash the run recorded.
   * Always from the token, never from a run's own copy, so what the owner
   * gets is what the chain holds; the last few rebuilt are kept.
   */
  async tokenModel(contract: string, tokenId: string, caller: string): Promise<Buffer> {
    if (!isModelToken(tokenId)) {
      throw new NotFoundError("No such model");
    }
    const { chain, appId } = this.#o;
    const collection = await chain.getCollection(contract);
    await this.#requireLaunched(contract, collection.factory_id);
    const model = await chain.getModel(contract, tokenId);
    if (!model) {
      throw new NotFoundError("No such model");
    }
    if (model.app_id !== appId) {
      throw new BadRequest("Another training app made this model; only that app can open it");
    }
    if (model.owner_id !== caller) {
      throw new ForbiddenError("Only the model's owner may open it");
    }
    const slot = `${contract}:${tokenId}`;
    const opened = this.#opened.get(slot);
    if (opened) {
      return Buffer.from(opened);
    }
    let opening = this.#opening.get(slot);
    if (!opening) {
      opening = (async () => {
        await this.#o.ensureRegistered(contract);
        const mpcPublicKey = await chain.mpcPublicKey(collection.key_source);
        const key = await this.#modelKey(contract, model.run_id, mpcPublicKey);
        const blob = await chain.fastfsStore(contract).get(model.sealed_ref);
        if (sha256Base64(blob) !== model.sealed_hash) {
          throw new ModelMismatch(`Model ${tokenId} does not match its record`);
        }
        let head: Head;
        try {
          head = openModel(key, blob, tokenId).head;
        } catch (error) {
          throw new ModelMismatch((error as Error).message);
        }
        const file = await (this.#o.assemble ?? assembleModel)({ head });
        if (sha256Hex(file) !== model.model_sha256) {
          // The file depends on the libraries that export it, so an app
          // whose libraries changed since the run can't reproduce it.
          throw new ModelMismatch(
            `Model ${tokenId} was rebuilt, but not as the file its run recorded`,
          );
        }
        this.#opened.set(slot, file);
        for (const oldest of this.#opened.keys()) {
          if (this.#opened.size <= MAX_OPENED_MODELS) {
            break;
          }
          this.#opened.delete(oldest);
        }
        return file;
      })().finally(() => this.#opening.delete(slot));
      this.#opening.set(slot, opening);
    }
    return Buffer.from(await opening);
  }

  /** The key of a run's model token, from the MPC network through the collection. */
  async #modelKey(contract: string, runId: string, mpcPublicKey: string): Promise<Buffer> {
    const tokenId = modelTokenId(runId);
    const keys = await fetchSampleKeys(
      contract,
      (_ids, appPublicKey) => this.#o.chain.requestModelKey(contract, runId, appPublicKey),
      mpcPublicKey,
      [tokenId],
      1,
    );
    return keys.get(tokenId) as Buffer;
  }

  /**
   * Seals what the run learned under its model token's key, stores it on
   * FastFS and mints the token to the renter. When the mint's outcome is
   * unknown, the chain is asked whether the token exists before trying again.
   */
  async #mint(state: RunState, classes: string[], head: Head, mpcPublicKey: string): Promise<void> {
    const { chain } = this.#o;
    const { contract, id: runId } = state;
    const tokenId = modelTokenId(runId);
    const key = await this.#modelKey(contract, runId, mpcPublicKey);
    const blob = sealModel(key, {
      v: 1,
      kind: "model-head",
      token_id: tokenId,
      run_id: runId,
      classes,
      head,
    });
    const ref = await chain.fastfsStore(contract).put(blob);
    const hash = sha256Base64(blob);
    for (let attempt = 0; ; attempt++) {
      try {
        const tx = await chain.mintModel(contract, runId, hash, ref);
        if (tx) {
          state.mintTx = tx;
        }
        break;
      } catch (error) {
        const minted = await chain.getModel(contract, tokenId).catch(() => null);
        if (minted?.sealed_ref === ref) {
          break;
        }
        if (error instanceof ContractRefusal || attempt > 0) {
          throw error;
        }
      }
    }
    state.modelToken = tokenId;
  }

  /**
   * A collection is code its deployer chose: one a renter wrote could relay
   * this app's signed calls elsewhere. Only the launchpad's are known to run
   * the published collection code.
   */
  async #requireLaunched(contract: string, factoryId: string | null): Promise<void> {
    const launchpad = this.#o.launchpadId;
    if (
      launchpad &&
      (factoryId !== launchpad || !(await this.#o.chain.isLaunched(launchpad, contract)))
    ) {
      throw new BadRequest(`This trainer only trains on collections from ${launchpad}`);
    }
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
    await this.#requireLaunched(contract, collection.factory_id);
    if (!collection.classes) {
      throw new BadRequest(`${contract} is not a dataset`);
    }
    // Checked before any key is asked for: without it the run can't be scored.
    const unscored = classWithoutHeldout(this.#o.heldoutDir, collection.classes);
    if (unscored !== undefined) {
      throw new BadRequest(`This training app has no held-out images for "${unscored}"`);
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
        (ids, appPublicKey) => chain.requestSampleKeys(contract, ids, appPublicKey),
        mpcPublicKey,
        tokenIds,
        this.#o.keysPerCall,
        KEY_CALLS_AT_ONCE,
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
          const ended = isRentalEnded(error);
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
      // The run stands whether or not its token can be minted: the renter
      // has paid, and the model is kept for them either way.
      state.stage = "minting";
      try {
        await this.#mint(state, checked.classes, result.head, mpcPublicKey);
      } catch (error) {
        console.error(`Run ${state.id}: the model token was not minted`, describe(error));
        state.mintProblem = MINT_PROBLEM;
      }
      state.stage = "done";
      this.#finish(state.id);
    } catch (error) {
      const message =
        error instanceof RunFailure
          ? error.message
          : error instanceof PythonError
            ? "Training failed"
            : state.stage === "done" || state.stage === "failed"
              ? "Run failed"
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
