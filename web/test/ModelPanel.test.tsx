import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import { ModelPanel, type ModelPanelProps } from "../src/components/ModelPanel.tsx";
import { SamplePanel } from "../src/components/SamplePanel.tsx";
import type { ModelView } from "../src/lib/contract.ts";
import { KeeperError } from "../src/lib/keeper.ts";
import type { TokenSession, Trainer } from "../src/lib/trainer.ts";

const MODEL = new TextEncoder().encode("onnx bytes");
const SHA = bytesToHex(sha256(MODEL));
const model: ModelView = {
  token_id: "model-run-0a1b2c3d4e5f",
  run_id: "run-0a1b2c3d4e5f",
  owner_id: "owner.test",
  app_id: "local-trainer",
  renter_id: "renter.test",
  model_sha256: SHA,
  accuracy_bps: 9050,
  token_count: 150,
  sealed_hash: "c2VhbGVk",
  sealed_ref: `fastfs:trainer.test:${"a".repeat(64)}:${"1".repeat(44)}`,
  recorded_at: "1700000000000000000",
};

function fakeTrainer(tokenModel: Trainer["tokenModel"]): Trainer {
  return {
    attestation: vi.fn(),
    info: vi.fn(),
    challenge: vi.fn(),
    createSession: vi.fn(),
    train: vi.fn(),
    run: vi.fn(),
    model: vi.fn(),
    tokenModel,
  };
}

function setup(overrides: Partial<ModelPanelProps> = {}, bytes: Uint8Array = MODEL) {
  const session: TokenSession = { call: (run) => run("token") };
  const trainer = fakeTrainer(vi.fn(async (given) => given.call(async () => bytes)));
  const props: ModelPanelProps = {
    contractId: "hotdogs.launch.test",
    model,
    classes: ["hotdog", "not_hotdog"],
    labels: { "local-trainer": "Hotdog CNN" },
    viewer: "owner.test",
    access: { trainer, session },
    save: vi.fn(),
    load: vi.fn(async () => ({
      classify: async () => ({ label: "hotdog", confidence: 0.9 }),
    })),
    heldout: vi.fn(async () => 0.9),
    ...overrides,
  };
  render(<ModelPanel {...props} />);
  return { props, trainer };
}

test("shows what the contract recorded for the model, and that its weights are sealed", () => {
  setup({ viewer: null });
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Model run-0a1b2c3d4e5f");
  const record = screen.getByRole("region", { name: "The model" });
  expect(record.textContent).toContain("Hotdog CNN (local-trainer)");
  expect(record.textContent).toContain("150 rented samples");
  expect(record.textContent).toContain("90.50%");
  expect(record.textContent).toContain("renter.test");
  expect(screen.getByTestId("model-sha256").textContent).toBe(`sha256 ${SHA}`);
  expect(screen.getByTestId("model-sealed-ref").textContent).toBe(model.sealed_ref);
  expect(screen.getByText(/Its weights are sealed/)).toBeTruthy();
  expect(screen.getByText(/Only the training app that made it can get their key/)).toBeTruthy();
});

test("the owner opens the model: checked against the on-chain hash, then tried and saved", async () => {
  const { props, trainer } = setup();
  await userEvent.click(screen.getByRole("button", { name: "Open the model" }));
  expect(await screen.findByText(/The file matches the hash recorded on-chain/)).toBeTruthy();
  expect(trainer.tokenModel).toHaveBeenCalledWith(
    expect.anything(),
    "hotdogs.launch.test",
    "model-run-0a1b2c3d4e5f",
  );
  // The bytes go to the try-out, held to the hash on-chain.
  expect(props.load).toHaveBeenCalledWith(MODEL, SHA);
  expect(await screen.findByText(/held-out accuracy in your browser: 90%/i)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Download model" }));
  expect(props.save).toHaveBeenCalledWith(MODEL, "hotdogs.launch.test-run-0a1b2c3d4e5f.onnx");
  expect(screen.queryByRole("button", { name: "Open the model" })).toBeNull();
});

test("refuses a file that isn't the model the chain recorded", async () => {
  const { props } = setup({}, new TextEncoder().encode("some other file"));
  await userEvent.click(screen.getByRole("button", { name: "Open the model" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(
    /doesn't match the hash recorded on-chain, so it wasn't opened/,
  );
  expect(props.load).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Download model" })).toBeNull();
  // It can be asked for again.
  expect(screen.getByRole("button", { name: "Open the model" })).toBeTruthy();
});

test("says, in the training app's words, why it wouldn't open the model", async () => {
  const session: TokenSession = { call: (run) => run("token") };
  const trainer = fakeTrainer(async () => {
    throw new KeeperError(400, "bad_request", "Another training app made this model");
  });
  setup({ access: { trainer, session } });
  await userEvent.click(screen.getByRole("button", { name: "Open the model" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Another training app made this model",
  );
});

test("only the owner is offered the model", () => {
  const { trainer } = setup({ viewer: "someone.test", children: <p>Give away</p> });
  expect(screen.queryByRole("button", { name: "Open the model" })).toBeNull();
  expect(screen.getByTestId("model-closed").textContent).toBe("Only its owner can open it.");
  // Nor what else is the owner's: giving it away.
  expect(screen.queryByText("Give away")).toBeNull();
  expect(trainer.tokenModel).not.toHaveBeenCalled();
});

test("asks a visitor without a wallet to connect the owner's", () => {
  setup({ viewer: null });
  expect(screen.queryByRole("button", { name: "Open the model" })).toBeNull();
  expect(screen.getByTestId("model-closed").textContent).toMatch(
    /Only its owner can open it\. Connect the wallet that owns this token/,
  );
});

test("says when this site has no address for the app that made the model", () => {
  setup({ access: undefined, children: <p>Give away</p> });
  expect(screen.queryByRole("button", { name: "Open the model" })).toBeNull();
  expect(screen.getByTestId("model-closed").textContent).toMatch(
    /no address for the training app that made it/,
  );
  // The owner can still give it away.
  expect(screen.getByText("Give away")).toBeTruthy();
});

test("a sample's run links to the token its model was minted as", () => {
  const run = (id: string) => ({
    run_id: id,
    app_id: "local-trainer",
    renter_id: "renter.test",
    model_sha256: SHA,
    accuracy_bps: 9000,
    token_count: 4,
    recorded_at: "1",
  });
  render(
    <MemoryRouter>
      <SamplePanel
        name="Sample #1"
        seed="1"
        owner="alice.near"
        loan={null}
        training={null}
        runs={[run("run-a"), run("run-b")]}
        runCount={2}
        labels={{}}
        modelPaths={{ "run-a": "/c/set.test/kat/model-run-a" }}
      />
    </MemoryRouter>,
  );
  const runs = screen.getByRole("region", { name: "Training runs" });
  const links = within(runs).getAllByRole("link", { name: "Its model is a token" });
  expect(links).toHaveLength(1);
  expect(links[0]?.getAttribute("href")).toBe("/c/set.test/kat/model-run-a");
});
