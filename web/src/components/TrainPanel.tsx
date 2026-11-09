import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { useEffect, useState } from "react";
import type { AppKeyView, Rental, RunView } from "../lib/contract.ts";
import { KeeperError } from "../lib/keeper.ts";
import type { Classifier, Picture } from "../lib/model.ts";
import { describeProblem } from "../lib/problems.ts";
import {
  MIN_TRAIN_SAMPLES,
  type RunState,
  type Stage,
  type TokenSession,
  type Trainer,
} from "../lib/trainer.ts";
import { Icon } from "./Icon.tsx";
import { TryModel } from "./TryModel.tsx";

export interface TrainerAccess {
  trainer: Trainer;
  /** Signs in to this trainer: one message for the wallet, kept for the tab. */
  session: TokenSession;
}

export interface TrainPanelProps {
  contractId: string;
  classes: string[];
  /** The account's unspent rentals, by app. */
  rentals: Rental[];
  /** App labels by app id. They are the apps' own words, so the id is shown too. */
  labels: Record<string, string>;
  /** The trainers this deployment knows the address of, by app id. */
  trainers: Record<string, TrainerAccess>;
  getRun: (runId: string) => Promise<RunView | null>;
  getAppKey: (publicKey: string) => Promise<AppKeyView | null>;
  /** A link to a transaction in an explorer, where one covers this network. */
  txUrl?: (hash: string) => string | null;
  pollMs?: number;
  /** The first wait before reading the run's record again; doubled each time. */
  retryMs?: number;
  save?: (bytes: Uint8Array, name: string) => void;
  /** Called when a run has finished, so the rentals can be read again. */
  onFinished?: () => void;
  load?: (bytes: Uint8Array, sha256: string) => Promise<Classifier>;
  heldout?: (classifier: Classifier, classes: string[]) => Promise<number>;
  decode?: (file: File) => Promise<Picture>;
}

const STEPS: Array<[Exclude<Stage, "failed">, string]> = [
  ["checking", "Checking your rentals"],
  ["keys", "Getting the samples' keys"],
  ["loading", "Loading the samples"],
  ["training", "Training"],
  ["recording", "Recording the run on-chain"],
  ["done", "Done"],
];

/** Gives up on a run after this many failed status checks in a row. */
const MAX_POLL_FAILURES = 10;
/** Tries at reading the run's record and the app's key before giving up. */
const READ_TRIES = 3;

/**
 * Reads up to three times, waiting `waitMs` then twice that between tries:
 * the RPC node may not show a just-recorded run yet. A null answer counts as
 * not there yet. Throws the last error if every try failed.
 */
async function readWithRetry<T>(read: () => Promise<T | null>, waitMs: number): Promise<T | null> {
  let failure: { error: unknown } | null = null;
  for (let attempt = 0; attempt < READ_TRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs * 2 ** (attempt - 1)));
    }
    try {
      const value = await read();
      if (value !== null) {
        return value;
      }
      failure = null;
    } catch (error) {
      failure = { error };
    }
  }
  if (failure) {
    throw failure.error;
  }
  return null;
}

const percent = (share: number) => `${Math.round(share * 100)}%`;
const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/** The training app's own words are the clearest; keeper-specific wording would mislead. */
function describe(error: unknown): string {
  return error instanceof KeeperError ? error.message : describeProblem(error);
}

function saveFile(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }),
  );
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Job =
  | { appId: string; phase: "starting" }
  | { appId: string; phase: "running"; run: RunState; lastStage: Stage; failures: number }
  | { appId: string; phase: "done"; run: RunState }
  | {
      appId: string;
      phase: "failed";
      run: RunState | null;
      lastStage: Stage | null;
      error: string;
    };

interface Proof {
  record: RunView | null;
  publicKey: string | null;
  appKey: AppKeyView | null;
  problem: string | null;
}

/**
 * Trains a model on the samples the account has rented: signs in to the
 * app's trainer, starts the run and follows it, checks the record the run
 * left on-chain, then offers the model to download and to try out here.
 */
export function TrainPanel({
  contractId,
  classes,
  rentals,
  labels,
  trainers,
  getRun,
  getAppKey,
  txUrl,
  pollMs = 1000,
  retryMs = 1000,
  save = saveFile,
  onFinished,
  load,
  heldout,
  decode,
}: TrainPanelProps) {
  const [job, setJob] = useState<Job | null>(null);
  const [proof, setProof] = useState<Proof | null>(null);
  const [model, setModel] = useState<Uint8Array | null>(null);
  const [modelProblem, setModelProblem] = useState<string | null>(null);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const busy = job?.phase === "starting" || job?.phase === "running";
  const access = job ? trainers[job.appId] : undefined;

  async function start(appId: string, tokenIds: string[]) {
    const chosen = trainers[appId];
    if (!chosen) {
      return;
    }
    setJob({ appId, phase: "starting" });
    setProof(null);
    setModel(null);
    setModelProblem(null);
    setSaveProblem(null);
    try {
      const run = await chosen.trainer.train(chosen.session, contractId, tokenIds);
      setJob({ appId, phase: "running", run, lastStage: run.stage, failures: 0 });
    } catch (error) {
      setJob({ appId, phase: "failed", run: null, lastStage: null, error: describe(error) });
    }
  }

  // Follows the run until it is done or has failed: each new state schedules the next check.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `onFinished` may change between checks.
  useEffect(() => {
    if (job?.phase !== "running" || !access) {
      return;
    }
    const { appId, lastStage } = job;
    let current = true;
    const timer = setTimeout(() => {
      access.trainer.run(job.run.id).then(
        (run) => {
          if (!current) {
            return;
          }
          if (run.stage === "done") {
            setJob({ appId, phase: "done", run });
            onFinished?.();
          } else if (run.stage === "failed") {
            setJob({
              appId,
              phase: "failed",
              run,
              lastStage,
              error: run.error ?? "The run failed.",
            });
            onFinished?.();
          } else {
            setJob({ appId, phase: "running", run, lastStage: run.stage, failures: 0 });
          }
        },
        (error: unknown) => {
          if (!current) {
            return;
          }
          if (job.failures + 1 >= MAX_POLL_FAILURES) {
            setJob({ appId, phase: "failed", run: job.run, lastStage, error: describe(error) });
          } else {
            setJob({ ...job, failures: job.failures + 1 });
          }
        },
      );
    }, pollMs);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [job, access, pollMs]);

  // Once done: the on-chain record, the key it was signed with, and the model itself.
  const doneId = job?.phase === "done" ? job.run.id : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per finished run.
  useEffect(() => {
    if (!doneId || !access) {
      return;
    }
    let current = true;
    Promise.all([
      readWithRetry(() => getRun(doneId), retryMs),
      readWithRetry(() => access.trainer.attestation(), retryMs).then(async (attestation) => {
        if (!attestation) {
          throw new Error("The training app gave no attestation");
        }
        const publicKey = attestation.public_key;
        return { publicKey, appKey: await readWithRetry(() => getAppKey(publicKey), retryMs) };
      }),
    ]).then(
      ([record, { publicKey, appKey }]) =>
        current && setProof({ record, publicKey, appKey, problem: null }),
      (error: unknown) =>
        current &&
        setProof({ record: null, publicKey: null, appKey: null, problem: describe(error) }),
    );
    access.trainer.model(access.session, doneId).then(
      (bytes) => current && setModel(bytes),
      (error: unknown) => current && setModelProblem(describe(error)),
    );
    return () => {
      current = false;
    };
  }, [doneId]);

  if (rentals.length === 0 && !job) {
    return null;
  }
  return (
    <section aria-labelledby="train" className="card">
      <h2 id="train" className="card-title flex items-center gap-2">
        <Icon name="sparkle" size={18} className="text-mist" />
        Train a model
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-mist">
        The training app opens your rented samples inside its own enclave, trains a small image
        classifier and records the run on-chain, which uses up the rentals. You get the model; the
        pictures stay with the app.
      </p>
      <ul className="mt-4 space-y-3">
        {rentals.map(({ appId, tokenIds }) => (
          <li key={appId} className="rounded-xl bg-black/25 p-4 ring-1 ring-cream/8">
            <p className="text-sm">
              {labels[appId] || "(no label)"}{" "}
              <span className="font-mono text-xs text-mist">({appId})</span>
            </p>
            {trainers[appId] && tokenIds.length < MIN_TRAIN_SAMPLES ? (
              <p className="mt-2 text-xs text-mist">
                You have {plural(tokenIds.length, "rented sample")} for it. A run needs at least{" "}
                {MIN_TRAIN_SAMPLES}: rent {MIN_TRAIN_SAMPLES - tokenIds.length} more for this app to
                train.
              </p>
            ) : trainers[appId] ? (
              <button
                type="button"
                className="button mt-3 w-full"
                disabled={busy}
                onClick={() => void start(appId, tokenIds)}
              >
                Train on {plural(tokenIds.length, "rented sample")}
              </button>
            ) : (
              <p className="mt-2 text-xs text-mist">
                You have {plural(tokenIds.length, "rented sample")} for it, but this site has no
                address for this training app, so it can't train here.
              </p>
            )}
          </li>
        ))}
      </ul>

      {job?.phase === "starting" && (
        <p className="mt-4 text-sm text-mist" role="status">
          Signing in to the training app and starting the run. Approve the message in your wallet if
          it asks.
        </p>
      )}
      {job && job.phase !== "starting" && <Progress job={job} />}
      {job?.phase === "failed" && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-alarm/30 bg-alarm/10 px-3 py-2 text-sm text-alarm"
        >
          {job.error}
        </p>
      )}

      {job?.phase === "done" && (
        <div className="mt-5 space-y-4">
          {job.run.partial && (
            <p
              role="status"
              className="flex items-start gap-2 rounded-xl border border-lamp/30 bg-lamp/10 px-3 py-2 text-sm text-lamp"
            >
              <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
              <span>{job.run.partial}. The model is still yours.</span>
            </p>
          )}
          <Record run={job.run} proof={proof} txUrl={txUrl} />
          {modelProblem && (
            <p role="alert" className="text-sm text-alarm">
              {modelProblem}
            </p>
          )}
          {model && (
            <button
              type="button"
              className="button button-quiet w-full"
              onClick={() => {
                // Only the model the chain recorded is saved.
                const recorded = proof?.record?.model_sha256.toLowerCase();
                if (!recorded) {
                  setSaveProblem(
                    "The run's record on-chain can't be read, so the model can't be checked. It wasn't saved.",
                  );
                } else if (bytesToHex(sha256(model)) !== recorded) {
                  setSaveProblem(
                    "This model doesn't match the hash recorded on-chain, so it wasn't saved.",
                  );
                } else {
                  setSaveProblem(null);
                  save(model, `${contractId}-${job.run.id}.onnx`);
                }
              }}
            >
              <Icon name="download" size={16} />
              Download model
            </button>
          )}
          {saveProblem && (
            <p role="alert" className="text-sm text-alarm">
              {saveProblem}
            </p>
          )}
          {model && proof?.record && (
            <TryModel
              bytes={model}
              sha256={proof.record.model_sha256}
              classes={classes}
              {...(load && { load })}
              {...(heldout && { heldout })}
              {...(decode && { decode })}
            />
          )}
        </div>
      )}
    </section>
  );
}

/** In place of the Train panel when the rentals couldn't be read: why, and a retry. */
export function RentalsUnavailable({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <section aria-labelledby="train" className="card">
      <h2 id="train" className="card-title flex items-center gap-2">
        <Icon name="sparkle" size={18} className="text-mist" />
        Train a model
      </h2>
      <p role="alert" className="mt-2 text-sm text-alarm">
        Can't read your rentals right now. {describeProblem(error)}
      </p>
      <button type="button" className="button button-quiet mt-3" onClick={onRetry}>
        Retry
      </button>
    </section>
  );
}

function Progress({ job }: { job: Exclude<Job, { phase: "starting" }> }) {
  const run = job.run;
  const reached = job.phase === "done" ? "done" : job.lastStage;
  const at = STEPS.findIndex(([stage]) => stage === reached);
  return (
    <ol aria-label="Progress" className="mt-4 space-y-1.5 text-sm">
      {STEPS.map(([stage, label], index) => {
        const state =
          index < at || job.phase === "done"
            ? "done"
            : index === at
              ? job.phase === "failed"
                ? "failed"
                : "now"
              : "later";
        const detail =
          stage === "training" && run?.epochs
            ? `: epoch ${run.epoch ?? 0} of ${run.epochs}`
            : stage === "done" && run?.accuracy !== undefined && job.phase === "done"
              ? `: ${percent(run.accuracy)} on the held-out set`
              : "";
        return (
          <li
            key={stage}
            className={`flex items-center gap-2 ${state === "later" ? "text-mist/60" : state === "failed" ? "text-alarm" : ""}`}
            aria-current={state === "now" ? "step" : undefined}
          >
            <span className="flex size-4 items-center justify-center" aria-hidden="true">
              {state === "done" ? (
                <Icon name="check" size={14} className="text-glow" />
              ) : state === "failed" ? (
                <Icon name="x" size={14} />
              ) : state === "now" ? (
                <span className="size-2 animate-pulse rounded-full bg-glow" />
              ) : (
                <span className="size-1.5 rounded-full bg-cream/30" />
              )}
            </span>
            {label}
            {detail}
          </li>
        );
      })}
    </ol>
  );
}

/** What the contract recorded for the run, checked against what the trainer said. */
function Record({
  run,
  proof,
  txUrl,
}: {
  run: RunState;
  proof: Proof | null;
  txUrl: ((hash: string) => string | null) | undefined;
}) {
  if (!proof) {
    return (
      <p className="text-sm text-mist" role="status">
        Reading the run's record on-chain…
      </p>
    );
  }
  if (proof.problem || !proof.record) {
    return (
      <p role="alert" className="text-sm text-alarm">
        {proof.problem
          ? `Couldn't read the run's record on-chain: ${proof.problem}`
          : "This run isn't recorded on-chain, so the model can't be checked."}
      </p>
    );
  }
  const { record, appKey, publicKey } = proof;
  const sameModel = record.model_sha256 === run.modelSha256;
  const keyIsTheApps = appKey !== null && appKey.app_id === record.app_id;
  const link = run.recordTx && txUrl ? txUrl(run.recordTx) : null;
  return (
    <section
      aria-label="On-chain record"
      className="space-y-2 rounded-xl bg-black/25 p-4 text-sm ring-1 ring-cream/8"
    >
      <p className="eyebrow flex items-center gap-2">
        <Icon name="shield" size={14} />
        On-chain record
      </p>
      <p>
        Run <span className="font-mono">{record.run_id}</span> is recorded for{" "}
        {plural(record.token_count, "sample")} by app{" "}
        <span className="font-mono">{record.app_id}</span>, at {record.accuracy_bps / 100}% held-out
        accuracy.
      </p>
      <p className={sameModel ? "text-mist" : "text-alarm"}>
        {sameModel
          ? "The model's hash matches the one recorded: "
          : "The training app's model hash differs from the one recorded: "}
        <span className="break-all font-mono text-cream">{record.model_sha256}</span>
      </p>
      {publicKey && (
        <p className={keyIsTheApps ? "text-mist" : "text-alarm"}>
          Recorded with the app's key{" "}
          <span className="break-all font-mono text-cream">{publicKey}</span>
          {keyIsTheApps
            ? appKey.trusted_by_admin
              ? ", which the collection's creator trusted for this app."
              : ", which the collection verified runs inside the app."
            : ", which this collection doesn't know as the app's key."}
        </p>
      )}
      {link && (
        <a
          className="inline-block text-glow underline"
          href={link}
          target="_blank"
          rel="noreferrer"
        >
          View the transaction
        </a>
      )}
    </section>
  );
}
