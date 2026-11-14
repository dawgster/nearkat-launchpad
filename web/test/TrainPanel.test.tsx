import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import {
  RentalsUnavailable,
  TrainPanel,
  type TrainPanelProps,
} from "../src/components/TrainPanel.tsx";
import type { AppKeyView, ModelView, RunView } from "../src/lib/contract.ts";
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
    tokenModel: vi.fn(async (session) => session.call(async () => MODEL)),
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
  // The minted model links to its token's page, so the panel sits in a router.
  render(
    <MemoryRouter>
      <TrainPanel {...props} />
    </MemoryRouter>,
  );
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

const finished = (): Partial<RunState> => ({
  stage: "done",
  accuracy: 0.75,
  modelSha256: SHA,
  recordedTokens: 4,
});

test("reads the record again until the chain shows it, then offers the try-out", async () => {
  const trainer = fakeTrainer([finished()]);
  const record = {
    run_id: "run-1",
    app_id: "local-trainer",
    renter_id: "me.test",
    model_sha256: SHA,
    accuracy_bps: 7500,
    token_count: 4,
    recorded_at: "1",
  };
  const getRun = vi
    .fn<TrainPanelProps["getRun"]>()
    .mockRejectedValueOnce(new Error("rpc busy"))
    .mockResolvedValueOnce(null)
    .mockResolvedValue(record);
  const { props } = setup(trainer, { getRun, retryMs: 1 });
  await userEvent.click(screen.getByRole("button", { name: "Train on 4 rented samples" }));
  expect(await screen.findByRole("region", { name: "On-chain record" })).toBeTruthy();
  expect(getRun).toHaveBeenCalledTimes(3);
  expect(props.load).toHaveBeenCalledWith(MODEL, SHA);
});

test("says why the record can't be read after three tries", async () => {
  const trainer = fakeTrainer([finished()]);
  const getRun = vi.fn(async () => {
    throw new Error("rpc down");
  });
  setup(trainer, { getRun, retryMs: 1 });
  await userEvent.click(screen.getByRole("button", { name: "Train on 4 rented samples" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/rpc down|can't|couldn't/i);
  expect(getRun).toHaveBeenCalledTimes(3);
});

test("refuses to save a model whose hash isn't the one recorded on-chain", async () => {
  const trainer = fakeTrainer([finished()]);
  const other = "0".repeat(64);
  const { props } = setup(trainer, {
    getRun: vi.fn(async () => ({
      run_id: "run-1",
      app_id: "local-trainer",
      renter_id: "me.test",
      model_sha256: other,
      accuracy_bps: 7500,
      token_count: 4,
      recorded_at: "1",
    })),
  });
  await userEvent.click(screen.getByRole("button", { name: "Train on 4 rented samples" }));
  await userEvent.click(await screen.findByRole("button", { name: "Download model" }));
  expect(props.save).not.toHaveBeenCalled();
  expect((await screen.findAllByRole("alert")).map((a) => a.textContent).join(" ")).toMatch(
    /doesn't match the hash recorded on-chain/,
  );
});

test("when the rentals can't be read, says so and reads them again on Retry", async () => {
  const retry = vi.fn();
  render(<RentalsUnavailable error={new Error("Too many requests")} onRetry={retry} />);
  expect((await screen.findByRole("alert")).textContent).toMatch(/can't read your rentals/i);
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledTimes(1);
});

test("says a run needs more than one rented sample instead of offering it", () => {
  const trainer = fakeTrainer([{}]);
  setup(trainer, { rentals: [{ appId: "local-trainer", tokenIds: ["1"] }] });
  expect(screen.queryByRole("button", { name: /^Train on/ })).toBeNull();
  expect(screen.getByText(/A run needs at least 2: rent 1 more for this app/)).toBeTruthy();
  expect(trainer.train).not.toHaveBeenCalled();
});

const mintedModel = (overrides: Partial<ModelView> = {}): ModelView => ({
  token_id: "model-run-1",
  run_id: "run-1",
  owner_id: "me.test",
  app_id: "local-trainer",
  renter_id: "me.test",
  model_sha256: SHA,
  accuracy_bps: 7500,
  token_count: 4,
  sealed_hash: "c2VhbGVk",
  sealed_ref: `fastfs:trainer.test:${"a".repeat(64)}:${"1".repeat(44)}`,
  recorded_at: "1700000000000000000",
  ...overrides,
});

test("shows the model minted as a token, checked on-chain, with a link to its page", async () => {
  const trainer = fakeTrainer([
    { stage: "recording" },
    { stage: "minting" },
    { ...finished(), modelToken: "model-run-1", mintTx: "MintTx1" },
  ]);
  const getModel = vi.fn(async () => mintedModel());
  setup(trainer, {
    getModel,
    tokenPath: (tokenId) => `/c/hotdogs.launch.test/kat/${tokenId}`,
  });
  await userEvent.click(screen.getByRole("button", { name: "Train on 4 rented samples" }));

  const progress = screen.getByRole("list", { name: "Progress" });
  expect(within(progress).getByText("Sealing the model as a token")).toBeTruthy();
  const token = await screen.findByRole("region", { name: "Model token" });
  expect(token.textContent).toContain("model-run-1");
  expect(token.textContent).toMatch(/sealed under the token's own key/);
  expect(await within(token).findByText(/names this model's hash/)).toBeTruthy();
  expect(token.textContent).toContain("me.test");
  expect(getModel).toHaveBeenCalledWith("model-run-1");
  expect(
    within(token).getByRole("link", { name: "Open the token's page" }).getAttribute("href"),
  ).toBe("/c/hotdogs.launch.test/kat/model-run-1");
  expect(
    within(token).getByRole("link", { name: "View the mint transaction" }).getAttribute("href"),
  ).toBe("https://explorer.test/txns/MintTx1");
  // The model still downloads from the run, as before.
  expect(await screen.findByRole("button", { name: "Download model" })).toBeTruthy();
});

test("says so when the token the training app names isn't on-chain, or names another model", async () => {
  const run = { ...finished(), modelToken: "model-run-1" };
  setup(fakeTrainer([run]), { getModel: vi.fn(async () => null), retryMs: 1 });
  await userEvent.click(screen.getByRole("button", { name: "Train on 4 rented samples" }));
  const token = await screen.findByRole("region", { name: "Model token" });
  expect(await within(token).findByText(/This token isn't on-chain/)).toBeTruthy();
  cleanup();

  setup(fakeTrainer([run]), {
    getModel: vi.fn(async () => mintedModel({ model_sha256: "0".repeat(64) })),
  });
  await userEvent.click(screen.getByRole("button", { name: "Train on 4 rented samples" }));
  const other = await screen.findByRole("region", { name: "Model token" });
  expect(await within(other).findByText(/names a different model's hash/)).toBeTruthy();
});

test("says why the model wasn't minted as a token, and still offers it", async () => {
  const trainer = fakeTrainer([
    { ...finished(), mintProblem: "The token's key could not be fetched." },
  ]);
  setup(trainer, { getModel: vi.fn(async () => null) });
  await userEvent.click(screen.getByRole("button", { name: "Train on 4 rented samples" }));
  expect(
    await screen.findByText(
      /The model wasn't minted as a token: The token's key could not be fetched\. You can still/,
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Model token" })).toBeNull();
  expect(await screen.findByRole("button", { name: "Download model" })).toBeTruthy();
});
