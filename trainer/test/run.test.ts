import { createHash } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { ContractRefusal } from "../src/chain.ts";
import { PythonError } from "../src/python.ts";
import { type RunState, Runs } from "../src/run.ts";
import { APP_ID, CONTRACT, FakePython, FakeTrainerChain, jpegFor, RENTER } from "./fakes.ts";

function setup() {
  const chain = new FakeTrainerChain();
  const python = new FakePython();
  const ensureRegistered = vi.fn(async (_contract: string) => {});
  const runs = new Runs({
    appId: APP_ID,
    appPublicKey: () => "ed25519:trainer",
    chain,
    python: python.run,
    heldoutDir: "/heldout",
    ensureRegistered,
  });
  return { chain, python, runs, ensureRegistered };
}

/** Waits for a run to finish, one way or the other. */
async function settle(runs: Runs, id: string): Promise<RunState> {
  await vi.waitFor(() => {
    const stage = runs.get(id)?.stage;
    if (stage !== "done" && stage !== "failed") {
      throw new Error(`still ${stage}`);
    }
  });
  return runs.get(id) as RunState;
}

describe("Runs", () => {
  test("trains on exactly the rented samples and records the run", async () => {
    const { chain, python, runs, ensureRegistered } = setup();
    await chain.addRentedSample("1", "cat");
    await chain.addRentedSample("2", "dog");
    await chain.addRentedSample("3", "cat");
    await chain.addRentedSample("4", "dog"); // rented, but not asked for

    const started = await runs.start(CONTRACT, RENTER, ["1", "2", "3"]);
    expect(started).toMatchObject({
      contract: CONTRACT,
      renter: RENTER,
      tokenIds: ["1", "2", "3"],
    });
    expect(started.id).toMatch(/^run-[0-9a-f]{12}$/);
    const done = await settle(runs, started.id);

    expect(done.stage).toBe("done");
    expect(ensureRegistered).toHaveBeenCalledWith(CONTRACT);
    expect(python.received.map((s) => s.label)).toEqual(["cat", "dog", "cat"]);
    expect(python.received.map((s) => s.jpeg)).toEqual(["1", "2", "3"].map(jpegFor));
    const sha = createHash("sha256").update(python.model).digest("hex");
    expect(chain.records).toEqual([
      {
        run_id: started.id,
        renter_id: RENTER,
        token_ids: ["1", "2", "3"],
        model_sha256: sha,
        accuracy_bps: 8750,
      },
    ]);
    expect(done).toMatchObject({ accuracy: 0.875, modelSha256: sha, recordedTokens: 3 });
    expect(done.partial).toBeUndefined();
    expect(runs.model(started.id, RENTER)).toEqual(python.model);
    // Nothing secret is kept in what the web sees.
    expect(JSON.stringify(done)).not.toContain(jpegFor("1").toString("base64"));
  });

  test("asks for keys at most ten at a time and records at most fifty at a time", async () => {
    const { chain, runs } = setup();
    const ids = Array.from({ length: 60 }, (_, i) => String(i + 1));
    for (const id of ids) {
      await chain.addRentedSample(id, Number(id) % 2 ? "cat" : "dog");
    }
    const { id } = await runs.start(CONTRACT, RENTER, ids);
    expect((await settle(runs, id)).stage).toBe("done");
    expect(chain.keyRequests.every((chunk) => chunk.length <= 10)).toBe(true);
    expect(chain.keyRequests.flat().sort()).toEqual([...ids].sort());
    expect(chain.records.map((r) => r.token_ids.length)).toEqual([50, 10]);
    expect(new Set(chain.records.map((r) => r.run_id))).toEqual(new Set([id]));
  });

  test("refuses tokens whose rental is spent or not the caller's", async () => {
    const { chain, runs } = setup();
    await chain.addRentedSample("1", "cat");
    await chain.addRentedSample("2", "dog");
    const training = chain.training.get("2");
    if (training) {
      training.spent = true;
    }
    await expect(runs.start(CONTRACT, RENTER, ["1", "2"])).rejects.toMatchObject({
      status: 400,
      message: "Sample 2: already used",
    });

    await chain.addRentedSample("2", "dog", "someone-else.near");
    await expect(runs.start(CONTRACT, RENTER, ["1", "2"])).rejects.toMatchObject({
      status: 400,
      message: "Sample 2: rented by someone else",
    });
    // No key was asked for.
    expect(chain.keyRequests).toEqual([]);
  });

  test("refuses rentals for another app, ended, or never made, and bad lists", async () => {
    const { chain, runs } = setup();
    await chain.addRentedSample("1", "cat");
    await chain.addRentedSample("2", "dog");
    chain.training.set("2", { apps: ["b".repeat(64)], app_id: "b".repeat(64), spent: false });
    await expect(runs.start(CONTRACT, RENTER, ["1", "2"])).rejects.toThrow(
      "Sample 2: rented for another training app",
    );
    await chain.addRentedSample("2", "dog");
    const loan = chain.loans.get("2");
    if (loan) {
      loan.status = "over";
    }
    await expect(runs.start(CONTRACT, RENTER, ["2"])).rejects.toThrow("Sample 2: rental ended");
    await expect(runs.start(CONTRACT, RENTER, ["9"])).rejects.toThrow("Sample 9: not rented");
    await expect(runs.start(CONTRACT, RENTER, [])).rejects.toMatchObject({ status: 400 });
    await expect(runs.start(CONTRACT, RENTER, ["1", "1"])).rejects.toThrow(
      "Sample 1: listed twice",
    );
    const many = Array.from({ length: 201 }, (_, i) => String(i));
    await expect(runs.start(CONTRACT, RENTER, many)).rejects.toMatchObject({ status: 400 });
    chain.classes = null;
    await expect(runs.start(CONTRACT, RENTER, ["1"])).rejects.toMatchObject({ status: 400 });
    expect(chain.keyRequests).toEqual([]);
  });

  test("refuses a token already in a running run", async () => {
    const { chain, python, runs } = setup();
    await chain.addRentedSample("1", "cat");
    await chain.addRentedSample("2", "dog");
    let release = () => {};
    python.gate = new Promise((resolve) => {
      release = resolve;
    });
    const first = await runs.start(CONTRACT, RENTER, ["1"]);
    await expect(runs.start(CONTRACT, RENTER, ["2", "1"])).rejects.toMatchObject({
      status: 400,
      message: "Sample 1: already in a run",
    });
    // Two starts at once can't both take the same sample.
    const both = await Promise.allSettled([
      runs.start(CONTRACT, RENTER, ["2"]),
      runs.start(CONTRACT, RENTER, ["2"]),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    release();
    expect((await settle(runs, first.id)).stage).toBe("done");
  });

  test("reports a rental that ended before recording", async () => {
    const { chain, runs } = setup();
    await chain.addRentedSample("1", "cat");
    await chain.addRentedSample("2", "dog");
    chain.recordFailure = "Sample 1: rental ended";
    const { id } = await runs.start(CONTRACT, RENTER, ["1", "2"]);
    const state = await settle(runs, id);
    expect(state).toMatchObject({
      stage: "failed",
      error: "A rental ended before the run was recorded",
    });
    expect(state.modelSha256).toBeUndefined();
    expect(state.recordedTokens).toBeUndefined();
    expect(chain.records).toEqual([]);
    expect(() => runs.model(id, RENTER)).toThrow();
    // The samples are free for another run.
    await expect(runs.start(CONTRACT, RENTER, ["1"])).resolves.toBeTruthy();
  });

  test("keeps the model when a later chunk fails after earlier ones were recorded", async () => {
    const { chain, python, runs } = setup();
    const ids = Array.from({ length: 60 }, (_, i) => String(i + 1));
    for (const id of ids) {
      await chain.addRentedSample(id, Number(id) % 2 ? "cat" : "dog");
    }
    chain.recordScript.push(null, new ContractRefusal("Sample 60: rental ended"));
    const { id } = await runs.start(CONTRACT, RENTER, ids);
    const state = await settle(runs, id);
    expect(state).toMatchObject({ stage: "done", recordedTokens: 50 });
    expect(state.partial).toBe(
      "Recorded 50 of 60 samples: a rental ended before the rest were recorded",
    );
    expect(chain.records.map((r) => r.token_ids.length)).toEqual([50]);
    const model = runs.model(id, RENTER);
    expect(createHash("sha256").update(model).digest("hex")).toBe(chain.records[0]?.model_sha256);
    expect(state.modelSha256).toBe(chain.records[0]?.model_sha256);
    // The unrecorded samples are no longer held by the run.
    python.gate = new Promise(() => {});
    await expect(runs.start(CONTRACT, RENTER, ["55"])).resolves.toBeTruthy();
  });

  test("retries a chunk once after a transport error", async () => {
    const { chain, runs } = setup();
    await chain.addRentedSample("1", "cat");
    chain.recordScript.push(new Error("fetch failed"));
    const { id } = await runs.start(CONTRACT, RENTER, ["1"]);
    expect(await settle(runs, id)).toMatchObject({ stage: "done", recordedTokens: 1 });
    expect(chain.recordCalls).toBe(2);
    expect((await settle(runs, id)).partial).toBeUndefined();

    // A panic is not retried, and a second transport error is the end of it.
    await chain.addRentedSample("2", "dog");
    chain.recordCalls = 0;
    chain.recordScript.push(new Error("timeout"), new Error("timeout"));
    const second = await runs.start(CONTRACT, RENTER, ["2"]);
    expect(await settle(runs, second.id)).toMatchObject({
      stage: "failed",
      error: "Could not record the run",
    });
    expect(chain.recordCalls).toBe(2);
    chain.recordCalls = 0;
    await chain.addRentedSample("3", "dog");
    chain.recordScript.push(new ContractRefusal("Sample 3: already used"));
    const third = await runs.start(CONTRACT, RENTER, ["3"]);
    expect((await settle(runs, third.id)).stage).toBe("failed");
    expect(chain.recordCalls).toBe(1);
  });

  test("counts a chunk whose call landed despite a transport error", async () => {
    const { chain, python, runs } = setup();
    await chain.addRentedSample("1", "cat");
    await chain.addRentedSample("2", "dog");
    chain.landedButLost = 1;
    const { id } = await runs.start(CONTRACT, RENTER, ["1", "2"]);
    const state = await settle(runs, id);
    expect(state).toMatchObject({ stage: "done", recordedTokens: 2 });
    expect(state.partial).toBeUndefined();
    expect(chain.recordCalls).toBe(1);
    expect(runs.model(id, RENTER)).toEqual(python.model);
  });

  test("hands out a copy of the model", async () => {
    const { chain, python, runs } = setup();
    await chain.addRentedSample("1", "cat");
    const { id } = await runs.start(CONTRACT, RENTER, ["1"]);
    await settle(runs, id);
    const original = Buffer.from(python.model);
    runs.model(id, RENTER).fill(0);
    expect(runs.model(id, RENTER)).toEqual(original);
  });

  test("serves the model only to the renter", async () => {
    const { chain, python, runs } = setup();
    await chain.addRentedSample("1", "cat");
    const { id } = await runs.start(CONTRACT, RENTER, ["1"]);
    await settle(runs, id);
    expect(runs.model(id, RENTER)).toEqual(python.model);
    expect(() => runs.model(id, "mallory.near")).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => runs.model("run-000000000000", RENTER)).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });

  test("never puts image bytes in an error", async () => {
    const { chain, python, runs } = setup();
    await chain.addRentedSample("1", "cat");
    const leaked = jpegFor("1").toString("base64");
    python.failure = new PythonError(1, `error: ValueError: bad image ${leaked}`);
    const { id } = await runs.start(CONTRACT, RENTER, ["1"]);
    const state = await settle(runs, id);
    expect(state).toMatchObject({ stage: "failed", error: "Training failed" });
    expect(JSON.stringify(state)).not.toContain(leaked);
    expect(chain.records).toEqual([]);
  });

  test("fails a run without a held-out set", async () => {
    const { chain, python, runs } = setup();
    await chain.addRentedSample("1", "cat");
    python.heldout = 0;
    const { id } = await runs.start(CONTRACT, RENTER, ["1"]);
    expect(await settle(runs, id)).toMatchObject({ stage: "failed", error: "No held-out set" });
    expect(chain.records).toEqual([]);
  });

  test("fails a sample whose label is not one of the classes", async () => {
    const { chain, python, runs } = setup();
    await chain.addRentedSample("1", "cat");
    await chain.addRentedSample("2", "horse");
    const { id } = await runs.start(CONTRACT, RENTER, ["1", "2"]);
    expect(await settle(runs, id)).toMatchObject({
      stage: "failed",
      error: "Sample 2 has a label outside the dataset's classes",
    });
    expect(python.received.map((s) => s.label)).not.toContain("horse");
    expect(chain.records).toEqual([]);
  });
});

describe("Runs memory bounds", () => {
  async function finishedRun(
    runs: Runs,
    chain: FakeTrainerChain,
    token: string,
  ): Promise<RunState> {
    await chain.addRentedSample(token, "cat");
    const started = await runs.start(CONTRACT, RENTER, [token]);
    return settle(runs, started.id);
  }

  test("keeps at most 20 runs, evicting the oldest finished one and its model", async () => {
    const { chain, runs } = setup();
    const ids: string[] = [];
    for (let i = 1; i <= 20; i++) {
      ids.push((await finishedRun(runs, chain, String(i))).id);
    }
    expect(runs.get(ids[0] as string)).toBeDefined();
    const newest = await finishedRun(runs, chain, "21");
    expect(runs.get(ids[0] as string)).toBeUndefined();
    expect(() => runs.model(ids[0] as string, RENTER)).toThrow(/No such run/);
    expect(runs.get(ids[1] as string)).toBeDefined();
    expect(runs.get(newest.id)).toBeDefined();
  });

  test("drops a model 24 hours after its run finished", async () => {
    let now = 1_000_000;
    const chain = new FakeTrainerChain();
    const python = new FakePython();
    const runs = new Runs({
      appId: APP_ID,
      appPublicKey: () => "ed25519:trainer",
      chain,
      python: python.run,
      heldoutDir: "/heldout",
      ensureRegistered: async () => {},
      now: () => now,
    });
    const done = await finishedRun(runs, chain, "1");
    now += 23 * 3_600_000;
    expect(runs.model(done.id, RENTER)).toEqual(python.model);
    now += 2 * 3_600_000;
    expect(() => runs.model(done.id, RENTER)).toThrow(/no model/);
    expect(runs.get(done.id)?.stage).toBe("done");
  });
});
