import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKey, Near, type PrivateKey, verifyNep413Signature } from "near-kit";
import { Sandbox } from "near-kit/sandbox";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { Auth } from "../src/auth.ts";
import { NearChain } from "../src/chain.ts";
import { STARTER_PERSONALITY } from "../src/context.ts";
import { KatService } from "../src/kats.ts";
import { keysFromRootSecret } from "../src/keys.ts";
import { Meter } from "../src/meter.ts";
import { FileStore } from "../src/store.ts";
import type { KatView } from "../src/types.ts";
import { FakeInference } from "./fakes.ts";

const WASM = fileURLToPath(new URL("../../contract/target/near/nearkat_nft.wasm", import.meta.url));
const CHAT = 2n * 10n ** 21n;
const SAVE = 5n * 10n ** 22n;
const RECIPIENT = "nearkat.xyz";

// Runs the real contract in a local sandbox node. Only inference is faked.
describe.skipIf(!existsSync(WASM))("keeper against the contract in a sandbox", () => {
  const keys = keysFromRootSecret(Buffer.alloc(32, 7));
  let sandbox: Sandbox;
  let contractId: string;
  let alice: { id: string; near: Near };
  let bob: { id: string; near: Near };
  let mallory: { id: string; near: Near };
  let chain: NearChain;
  let meter: Meter;
  let kats: KatService;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    sandbox = await Sandbox.start();
    const root = sandbox.rootAccount.id;
    const rootNear = new Near({ network: sandbox });
    const stamp = Date.now();

    const account = async (name: string, publicKey: string) => {
      const id = `${name}-${stamp}.${root}`;
      await rootNear
        .transaction(root)
        .createAccount(id)
        .transfer(id, "50 NEAR")
        .addKey(publicKey, { type: "fullAccess" })
        .send();
      return id;
    };
    const user = async (name: string) => {
      const pair = generateKey();
      const id = await account(name, pair.publicKey.toString());
      const near = new Near({
        network: sandbox,
        privateKey: pair.secretKey as PrivateKey,
        defaultSignerId: id,
      });
      return { id, near };
    };

    const keeperId = await account("keeper", keys.nearPublicKey());
    alice = await user("alice");
    bob = await user("bob");
    mallory = await user("mallory");

    const owner = generateKey();
    contractId = await account("nearkat", owner.publicKey.toString());
    await new Near({
      network: sandbox,
      privateKey: owner.secretKey as PrivateKey,
      defaultSignerId: contractId,
    })
      .transaction(contractId)
      .deployContract(contractId, await readFile(WASM))
      .functionCall(contractId, "new", {
        admin_id: root,
        keeper_id: keeperId,
        treasury_id: root,
        mint_price: (10n ** 24n).toString(),
        base_uri: "https://art.example/",
      })
      .send();

    const keeperNear = new Near({
      network: sandbox,
      privateKey: keys.nearPrivateKey(),
      defaultSignerId: keeperId,
    });
    chain = new NearChain(keeperNear, contractId, "optimistic");
    meter = new Meter(chain);
    kats = new KatService({
      chain,
      store: new FileStore(await mkdtemp(join(tmpdir(), "keeper-it-"))),
      keys,
      inference: new FakeInference(),
      meter,
      prices: { chat: CHAT, save: SAVE },
    });
    const auth = new Auth({
      sessionKey: keys.sessionKey(),
      recipient: RECIPIENT,
      verify: (signed, params) => verifyNep413Signature(signed, params, { near: keeperNear }),
    });
    app = createApp({
      auth,
      kats,
      attestation: async () => ({ mode: "local" }),
      webOrigin: "http://localhost:3000",
    });
  }, 180_000);

  afterAll(async () => {
    await sandbox?.stop();
  });

  /** Signs the keeper's challenge with a wallet key, as the web app will. */
  async function signIn(signer: Near, claimedAccountId?: string): Promise<Response> {
    const challenge = await (await app.request("/auth/challenge", { method: "POST" })).json();
    const signed = await signer.signMessage({
      message: challenge.message,
      recipient: challenge.recipient,
      nonce: Buffer.from(challenge.nonce, "base64"),
    });
    return app.request("/auth/session", {
      method: "POST",
      body: JSON.stringify({
        nonce: challenge.nonce,
        signed_message: { ...signed, accountId: claimedAccountId ?? signed.accountId },
      }),
    });
  }

  const call = (token: string, path: string, method: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  test("a kat's shaped personality follows it to a new owner", async () => {
    await alice.near.call(contractId, "mint", {}, { attachedDeposit: "3 NEAR" });
    expect(await kats.wakeNew()).toEqual(["1"]);

    const aliceToken = (await (await signIn(alice.near)).json()).token as string;
    const fresh = await call(aliceToken, "/kats/1/context", "GET");
    expect(await fresh.json()).toMatchObject({ personality: STARTER_PERSONALITY, version: 1 });

    const shaped = await call(aliceToken, "/kats/1/personality", "PUT", {
      prompt: "You are grumpy.",
    });
    expect(await shaped.json()).toMatchObject({ personality: "You are grumpy.", version: 2 });
    const chat = await call(aliceToken, "/kats/1/chat", "POST", { message: "hello" });
    expect(await chat.json()).toMatchObject({ reply: "reply 1" });

    const before = BigInt(((await chain.getKat("1")) as KatView).balance);
    await meter.flush();
    const after = (await chain.getKat("1")) as KatView;
    expect(before - BigInt(after.balance)).toBe(SAVE + CHAT);
    expect(after.context_version).toBe("2");

    await alice.near.call(
      contractId,
      "nft_transfer",
      { receiver_id: bob.id, token_id: "1" },
      { attachedDeposit: "1 yocto" },
    );

    expect((await call(aliceToken, "/kats/1/context", "GET")).status).toBe(403);
    expect((await call(aliceToken, "/kats/1/chat", "POST", { message: "hi" })).status).toBe(403);

    const bobToken = (await (await signIn(bob.near)).json()).token as string;
    const inherited = await call(bobToken, "/kats/1/context", "GET");
    expect(await inherited.json()).toMatchObject({ personality: "You are grumpy.", version: 2 });
  }, 120_000);

  test("signing with your own key does not let you claim someone else's account", async () => {
    const response = await signIn(mallory.near, bob.id);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "invalid_signature" });
  }, 60_000);
});
