import { Near, type SignedMessage, verifyNep413Signature } from "near-kit";
import { describe, expect, test, vi } from "vitest";
import { Auth, SIGN_IN_MESSAGE } from "../../keeper/src/auth.ts";
import { keysFromRootSecret } from "../../keeper/src/keys.ts";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { Runs } from "../src/run.ts";
import {
  APP_ID,
  CONTRACT,
  FakePython,
  FakeTrainerChain,
  HELDOUT,
  jpegFor,
  RENTER,
} from "./fakes.ts";

const keys = keysFromRootSecret(Buffer.alloc(32, 9));

/** The fields of a RunState, and so the only ones /runs/:id may show. */
const RUN_FIELDS = [
  "id",
  "contract",
  "renter",
  "tokenIds",
  "stage",
  "epoch",
  "epochs",
  "accuracy",
  "modelSha256",
  "recordedTokens",
  "recordTx",
  "partial",
  "error",
];

function setup() {
  const chain = new FakeTrainerChain();
  const python = new FakePython();
  const runs = new Runs({
    appId: APP_ID,
    chain,
    python: python.run,
    heldoutDir: HELDOUT,
    ensureRegistered: async () => {},
  });
  const auth = new Auth({
    sessionKey: keys.sessionKey(),
    recipient: "nearkat.xyz",
    verify: async (signed) => signed.signature === "valid",
  });
  const app = createApp({
    auth,
    runs,
    attestation: async () => ({ mode: "local" }),
    info: { app_id: APP_ID, label: "Hotdog CNN", classes_supported: "any", heldout: 12 },
    webOrigins: ["http://localhost:3000"],
  });
  const signIn = async (accountId: string) => {
    const { nonce } = await (await app.request("/auth/challenge", { method: "POST" })).json();
    const signed: SignedMessage = { accountId, publicKey: "ed25519:pk", signature: "valid" };
    const response = await app.request("/auth/session", {
      method: "POST",
      body: JSON.stringify({ nonce, signed_message: signed }),
    });
    return (await response.json()).token as string;
  };
  const as = (token: string, body?: unknown, method = "POST"): RequestInit => ({
    method,
    headers: { authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { app, chain, python, signIn, as };
}

async function train(ctx: ReturnType<typeof setup>, token: string) {
  await ctx.chain.addRentedSample("1", "cat");
  await ctx.chain.addRentedSample("2", "dog");
  const response = await ctx.app.request(
    "/train",
    ctx.as(token, { contract: CONTRACT, token_ids: ["1", "2"] }),
  );
  return { response, run: await response.json() };
}

async function finished(ctx: ReturnType<typeof setup>, id: string) {
  let state: Record<string, unknown> = {};
  await vi.waitFor(async () => {
    state = await (await ctx.app.request(`/runs/${id}`)).json();
    if (state.stage !== "done" && state.stage !== "failed") {
      throw new Error(`still ${state.stage}`);
    }
  });
  return state;
}

describe("trainer HTTP API", () => {
  test("starts a run for the renter's session", async () => {
    const ctx = setup();
    const token = await ctx.signIn(RENTER);
    const { response, run } = await train(ctx, token);
    expect(response.status).toBe(202);
    expect(run).toMatchObject({ contract: CONTRACT, renter: RENTER, tokenIds: ["1", "2"] });
    expect((await finished(ctx, run.id)).stage).toBe("done");
  });

  test("serves the model only to the renter", async () => {
    const ctx = setup();
    const renter = await ctx.signIn(RENTER);
    const { run } = await train(ctx, renter);
    await finished(ctx, run.id);

    const other = await ctx.signIn("someone.near");
    expect(
      (await ctx.app.request(`/runs/${run.id}/model`, ctx.as(other, undefined, "GET"))).status,
    ).toBe(403);
    expect((await ctx.app.request(`/runs/${run.id}/model`)).status).toBe(401);

    const ok = await ctx.app.request(`/runs/${run.id}/model`, ctx.as(renter, undefined, "GET"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/octet-stream");
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(ctx.python.model);
  });

  test("the model is not there until the run is done", async () => {
    const ctx = setup();
    let release = () => {};
    ctx.python.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const renter = await ctx.signIn(RENTER);
    const { run } = await train(ctx, renter);
    const early = await ctx.app.request(`/runs/${run.id}/model`, ctx.as(renter, undefined, "GET"));
    expect(early.status).toBe(404);
    release();
    await finished(ctx, run.id);
  });

  test("run status never includes samples or keys", async () => {
    const ctx = setup();
    const token = await ctx.signIn(RENTER);
    const { run } = await train(ctx, token);
    const state = await finished(ctx, run.id);
    expect(Object.keys(state).every((key) => RUN_FIELDS.includes(key))).toBe(true);
    expect(state.recordTx).toBe("tx-1");
    const text = JSON.stringify(state);
    expect(text).not.toContain(jpegFor("1").toString("base64"));
    expect(text).not.toContain(token);
  });

  test("train without a session is refused", async () => {
    const { app } = setup();
    const response = await app.request("/train", {
      method: "POST",
      body: JSON.stringify({ contract: CONTRACT, token_ids: ["1"] }),
    });
    expect(response.status).toBe(401);
  });

  test("answers a failed check with 400 and the reason", async () => {
    const ctx = setup();
    const token = await ctx.signIn(RENTER);
    const response = await ctx.app.request(
      "/train",
      ctx.as(token, { contract: CONTRACT, token_ids: ["9"] }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Sample 9: not rented");
  });

  test("refuses a malformed train request", async () => {
    const ctx = setup();
    const token = await ctx.signIn(RENTER);
    for (const body of [
      { token_ids: ["1"] },
      { contract: CONTRACT },
      { contract: CONTRACT, token_ids: [1] },
      { contract: CONTRACT, token_ids: [] },
    ]) {
      expect((await ctx.app.request("/train", ctx.as(token, body))).status).toBe(400);
    }
  });

  test("an unknown run is 404", async () => {
    const { app } = setup();
    expect((await app.request("/runs/run-nope")).status).toBe(404);
  });

  test("publishes its info and attestation without a session", async () => {
    const { app } = setup();
    expect(await (await app.request("/info")).json()).toEqual({
      app_id: APP_ID,
      label: "Hotdog CNN",
      classes_supported: "any",
      heldout: 12,
    });
    expect(await (await app.request("/attestation")).json()).toEqual({ mode: "local" });
  });

  test("answers only the web app's origin", async () => {
    const { app } = setup();
    const ok = await app.request("/info", { headers: { origin: "http://localhost:3000" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const other = await app.request("/info", { headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("sign-in recipient", () => {
  test("a sign-in signed for the keeper does not open a session with the trainer", async () => {
    const recipient = loadConfig({
      TRAINER_ACCOUNT_ID: "trainer.testnet",
      TRAINER_ROOT_SECRET: "ab".repeat(32),
    }).authRecipient;
    // The keeper's default recipient.
    expect(recipient).not.toBe("nearkat.xyz");
    const auth = new Auth({
      sessionKey: keys.sessionKey(),
      recipient,
      verify: (signed, params) => verifyNep413Signature(signed, params),
    });
    const user = new Near({
      network: "testnet",
      privateKey: keysFromRootSecret(Buffer.alloc(32, 4)).nearPrivateKey(),
      defaultSignerId: RENTER,
    });
    const signFor = async (to: string) => {
      const { nonce } = auth.challenge();
      const signed = await user.signMessage({
        message: SIGN_IN_MESSAGE,
        recipient: to,
        nonce: Buffer.from(nonce, "base64"),
      });
      return { nonce, signed };
    };
    const forKeeper = await signFor("nearkat.xyz");
    await expect(auth.createSession(forKeeper.signed, forKeeper.nonce)).rejects.toMatchObject({
      status: 401,
    });
    const forTrainer = await signFor(recipient);
    expect((await auth.createSession(forTrainer.signed, forTrainer.nonce)).account_id).toBe(RENTER);
  });
});
