import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { TrainPanel, type TrainPanelProps } from "../src/components/TrainPanel.tsx";
import type { AppKeyView, RunView } from "../src/lib/contract.ts";
import { KeeperError } from "../src/lib/keeper.ts";
import type { RunState, TokenSession, Trainer } from "../src/lib/trainer.ts";

const MODEL = new TextEncoder().encode("onnx bytes");
const SHA = bytesToHex(sha256(MODEL));
const base: RunState = {
  id: "run-1",
  contract: "hotdogs.launch.test",
  renter: "me.test",
  tokenIds: ["1", "2", "3", "4"],
  stage: "checking",
};

function fakeTrainer(states: Array<Partial<RunState>>) {
  const queue = states.map((state) => ({ ...base, ...state }));
  const trainer: Trainer = {
    attestation: vi.fn(async () => ({
      mode: "local" as const,
      app_id: "local-trainer",
      public_key: "ed25519:TrainerKey",
      seal_public_key: "00",
    })),
    info: vi.fn(async () => ({
      app_id: "local-trainer",
      label: "Hotdog CNN",
      classes_supported: "any" as const,
      heldout: 50,
    })),
    challenge: vi.fn(),
    createSession: vi.fn(),
    train: vi.fn(async (session) => session.call(async () => ({ ...base }))),
    run: vi.fn(async () => (queue.length > 1 ? queue.shift() : queue[0]) as RunState),
    model: vi.fn(async (session) => session.call(async () => MODEL)),
  };
  return trainer;
}

function setup(trainer: Trainer, overrides: Partial<TrainPanelProps> = {}) {
  const session: TokenSession = { call: (run) => run("token") };
  const record: RunView = {
    run_id: "run-1",
    app_id: "local-trainer",
    renter_id: "me.test",
    model_sha256: SHA,
    accuracy_bps: 7500,
    token_count: 4,
    recorded_at: "1700000000000000000",
  };
  const appKey: AppKeyView = {
    app_id: "local-trainer",
    label: "Hotdog CNN",
    seal_public_key: "00",
    attested_at: "1700000000000000000",
    trusted_by_admin: true,
  };
  const props: TrainPanelProps = {
    contractId: "hotdogs.launch.test",
    classes: ["hotdog", "not_hotdog"],
    rentals: [{ appId: "local-trainer", tokenIds: ["1", "2", "3", "4"] }],
    labels: { "local-trainer": "Hotdog CNN" },
    trainers: { "local-trainer": { trainer, session } },
    getRun: vi.fn(async () => record),
    getAppKey: vi.fn(async () => appKey),
    txUrl: (hash) => `https://explorer.test/txns/${hash}`,
    pollMs: 1,
    save: vi.fn(),
    load: vi.fn(async () => ({
      classify: async () => ({ label: "hotdog", confidence: 0.9 }),
    })),
    heldout: vi.fn(async () => 0.7),
    ...overrides,
  };
  render(<TrainPanel {...props} />);
  return { props, session };
}

test("walks through the stages to a downloadable model", async () => {
  const trainer = fakeTrainer([
    { stage: "keys" },
    { stage: "loading" },
    { stage: "training", epoch: 1, epochs: 3 },
    { stage: "training", epoch: 3, epochs: 3 },
    { stage: "recording", epoch: 3, epochs: 3 },
    {
      stage: "done",
      epoch: 3,
      epochs: 3,
      accuracy: 0.75,
      modelSha256: SHA,
      recordedTokens: 4,
      recordTx: "TxHash1",
    },
  ]);
  const { props } = setup(trainer);
  await userEvent.click(screen.getByRole("button", { name: "Train on 4 rented samples" }));

  const progress = screen.getByRole("list", { name: "Progress" });
  expect(await within(progress).findByText(/epoch 3 of 3/)).toBeTruthy();
  expect(trainer.train).toHaveBeenCalledWith(expect.anything(), "hotdogs.launch.test", [
    "1",
    "2",
    "3",
    "4",
  ]);
  // The on-chain record backs up what the trainer said.
  const record = await screen.findByRole("region", { name: "On-chain record" });
  expect(record.textContent).toContain("4 samples");
  expect(record.textContent).toContain("75%");
  expect(record.textContent).toContain("ed25519:TrainerKey");
  expect(
    within(record)
      .getByRole("link", { name: /transaction/i })
      .getAttribute("href"),
  ).toBe("https://explorer.test/txns/TxHash1");
  expect(props.getRun).toHaveBeenCalledWith("run-1");
  expect(props.getAppKey).toHaveBeenCalledWith("ed25519:TrainerKey");

  await userEvent.click(await screen.findByRole("button", { name: "Download model" }));
  expect(props.save).toHaveBeenCalledWith(MODEL, "hotdogs.launch.test-run-1.onnx");
  // The bytes go to the try-out, checked against the hash on-chain.
  expect(props.load).toHaveBeenCalledWith(MODEL, SHA);
  expect(await screen.findByText(/held-out accuracy in your browser: 70%/i)).toBeTruthy();
});

test("warns when only part of the run was recorded, and still offers the model", async () => {
  const trainer = fakeTrainer([
    {
      stage: "done",
      accuracy: 0.75,
      modelSha256: SHA,
      recordedTokens: 2,
      partial: "Recorded 2 of 4 samples: the rest could not be recorded",
    },
  ]);
  setup(trainer);
  await userEvent.click(screen.getByRole("button", { name: "Train on 4 rented samples" }));
  expect(await screen.findByText(/Recorded 2 of 4 samples/)).toBeTruthy();
  expect(await screen.findByRole("button", { name: "Download model" })).toBeTruthy();
});

test("shows why a run failed", async () => {
  const trainer = fakeTrainer([
    { stage: "keys" },
    { stage: "failed", error: "Could not get the samples' keys" },
  ]);
  setup(trainer);
  await userEvent.click(screen.getByRole("button", { name: "Train on 4 rented samples" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Could not get the samples' keys",
  );
  expect(screen.queryByRole("button", { name: "Download model" })).toBeNull();
});

test("shows why the trainer refused to start", async () => {
  const trainer = fakeTrainer([]);
  trainer.train = vi.fn(async () => {
    throw new KeeperError(400, "bad_request", "Sample 3: already used");
  });
  setup(trainer);
  await userEvent.click(screen.getByRole("button", { name: "Train on 4 rented samples" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Sample 3: already used");
});

test("says when this app has no address for an app's trainer", () => {
  setup(fakeTrainer([]), { trainers: {} });
  expect(screen.queryByRole("button", { name: /Train on/ })).toBeNull();
  expect(screen.getByText(/no address for this training app/i)).toBeTruthy();
});
