import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { type Head, parseHead } from "./model.ts";

/** The Python trainer's project: `train.py` and its locked dependencies. */
const PY_DIR = resolve(import.meta.dirname, "../py");

/** What `train.py` prints on stdout, one JSON object a line. */
export type Progress =
  | { stage: "loaded"; count: number }
  | { stage: "epoch"; epoch: number; epochs: number; loss: number }
  | { stage: "done"; accuracy: number; heldout: number; seconds: number };

/**
 * Python failed. The message is always the same: what Python printed to
 * stderr may quote a sample, so it is never kept.
 */
export class PythonError extends Error {
  readonly exitCode: number | null;

  constructor(exitCode: number | null, _detail?: string) {
    super("Training failed");
    this.exitCode = exitCode;
  }
}

/** `TRAINER_PYTHON`, if set, is the interpreter that runs the script; otherwise uv does. */
function defaultCommand(name = "train.py"): string[] {
  const script = join(PY_DIR, name);
  const python = process.env.TRAINER_PYTHON;
  return python ? [python, script] : ["uv", "run", "--project", PY_DIR, "python", script];
}

/** Python needs none of the app's secrets. */
function childEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/KEY|SECRET|TOKEN|PASSWORD|MNEMONIC|SEED/i.test(name),
    ),
  );
}

/** Errors from writing to a process that has already exited. */
const BROKEN_PIPE = new Set(["EPIPE", "ERR_STREAM_DESTROYED", "ERR_STREAM_PREMATURE_CLOSE"]);

/**
 * Trains on `samples`, streamed to `train.py` as they arrive, and evaluates
 * on `heldoutDir`. The model, and the head it trained on its own, are
 * written to tmpfs (`/dev/shm` when there is one), read back and deleted. An
 * error from `samples` stops Python and is passed on; a failure of Python
 * itself is a `PythonError`.
 */
export async function runPython(args: {
  classes: string[];
  heldoutDir: string;
  samples: AsyncIterable<{ label: string; jpeg: Buffer }>;
  onProgress(p: Progress): void;
  signal?: AbortSignal;
  epochs?: number;
  seconds?: number;
  /** Replaces the command that runs `train.py`; for tests. */
  command?: string[];
}): Promise<{ accuracy: number; heldout: number; model: Buffer; head: Head }> {
  const dir = await mkdtemp(join(existsSync("/dev/shm") ? "/dev/shm" : tmpdir(), "kat-run-"));
  try {
    const out = join(dir, "model.onnx");
    const headOut = join(dir, "head.json");
    const [command = "", ...rest] = args.command ?? defaultCommand();
    const flags = [
      "--classes",
      args.classes.join(","),
      "--heldout",
      args.heldoutDir,
      "--out",
      out,
      "--head-out",
      headOut,
    ];
    if (args.epochs !== undefined) {
      flags.push("--epochs", String(args.epochs));
    }
    if (args.seconds !== undefined) {
      flags.push("--seconds", String(args.seconds));
    }
    const child = spawn(command, [...rest, ...flags], {
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv(),
      signal: args.signal,
    });
    const exited = new Promise<number | null>((done) => {
      child.on("close", (code) => done(code));
      child.on("error", () => done(null));
    });
    // stderr may quote a sample: drain it and keep nothing.
    child.stderr.resume();

    let result: Progress & { stage: "done" } = {
      stage: "done",
      accuracy: 0,
      heldout: 0,
      seconds: 0,
    };
    let finished = false;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let event: Progress;
      try {
        event = JSON.parse(line) as Progress;
      } catch {
        return; // Library chatter, not an event.
      }
      if (!event || typeof event !== "object") {
        return;
      }
      if (event.stage === "done") {
        result = event;
        finished = true;
      }
      if (event.stage === "loaded" || event.stage === "epoch" || event.stage === "done") {
        args.onProgress(event);
      }
    });

    let inputError: unknown = null;
    async function* encoded() {
      for await (const sample of args.samples) {
        yield `${JSON.stringify({ label: sample.label, jpeg: sample.jpeg.toString("base64") })}\n`;
      }
    }
    await pipeline(Readable.from(encoded()), child.stdin).catch((error: unknown) => {
      const code = (error as { code?: string }).code;
      if (!code || !BROKEN_PIPE.has(code)) {
        inputError = error;
        child.kill("SIGKILL");
      }
    });
    const code = await exited;
    if (inputError) {
      throw inputError;
    }
    if (code !== 0 || !finished) {
      throw new PythonError(code);
    }
    let model: Buffer;
    let head: Head;
    try {
      model = await readFile(out);
      head = parseHead(JSON.parse(await readFile(headOut, "utf8")));
    } catch {
      throw new PythonError(code);
    }
    return { accuracy: result.accuracy, heldout: result.heldout, model, head };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** How long `assemble.py` may take: it loads the backbone and exports, a few seconds. */
const ASSEMBLE_TIMEOUT_MS = 120_000;

/**
 * Rebuilds a run's model file from its head and the public backbone, with
 * `assemble.py`: byte for byte the file `train.py` exported, as long as the
 * libraries are the same. Written to tmpfs, read back and deleted. A failure
 * is a `PythonError`.
 */
export async function assembleModel(args: {
  head: Head;
  signal?: AbortSignal;
  /** Replaces the command that runs `assemble.py`; for tests. */
  command?: string[];
}): Promise<Buffer> {
  const dir = await mkdtemp(join(existsSync("/dev/shm") ? "/dev/shm" : tmpdir(), "kat-run-"));
  try {
    const out = join(dir, "model.onnx");
    const [command = "", ...rest] = args.command ?? defaultCommand("assemble.py");
    const child = spawn(command, [...rest, "--out", out], {
      stdio: ["pipe", "ignore", "ignore"],
      env: childEnv(),
      signal: args.signal ?? AbortSignal.timeout(ASSEMBLE_TIMEOUT_MS),
    });
    const exited = new Promise<number | null>((done) => {
      child.on("close", (code) => done(code));
      child.on("error", () => done(null));
    });
    child.stdin.on("error", () => {}); // The exit code tells.
    child.stdin.end(JSON.stringify(args.head));
    const code = await exited;
    if (code !== 0) {
      throw new PythonError(code);
    }
    try {
      return await readFile(out);
    } catch {
      throw new PythonError(code);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
