import type { SignedMessage } from "near-kit";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { Auth } from "../src/auth.ts";
import { DEFAULT_COLLECTION } from "../src/collection.ts";
import { STARTER_PERSONALITY } from "../src/context.ts";
import { Ingest } from "../src/ingest.ts";
import { KatService } from "../src/kats.ts";
import { keysFromRootSecret } from "../src/keys.ts";
import { Meter } from "../src/meter.ts";
import { RateLimiter } from "../src/ratelimit.ts";
import { SAMPLE_INFO } from "../src/samples.ts";
import { IMPORT_INFO, sealTo } from "../src/sealing.ts";
import { MemoryStore } from "../src/store.ts";
import {
  FAKE_COLLECTION,
  FakeChain,
  FakeInference,
  KEY_SOURCE,
  keyringFor,
  NEAR,
} from "./fakes.ts";

const keys = keysFromRootSecret(Buffer.alloc(32, 7));

async function setup(
  limits?: { chat: RateLimiter; read?: RateLimiter; auth: RateLimiter },
  trustProxy = false,
  historyImport = true,
) {
  const chain = new FakeChain();
  const inference = new FakeInference();
  const kats = new KatService({
    collection: { ...DEFAULT_COLLECTION, history_import: historyImport },
    chain,
    store: new MemoryStore(),
    keyring: keyringFor(chain),
    inference,
    meter: new Meter(chain),
    prices: { chat: 2n * 10n ** 21n, save: 5n * 10n ** 22n },
    retryDelayMs: 0,
  });
  // Accepts any signature whose text is "valid".
  const auth = new Auth({
    sessionKey: keys.sessionKey(),
    recipient: "nearkat.xyz",
    verify: async (signed) => signed.signature === "valid",
  });
  const app = createApp({
    auth,
    kats,
    attestation: async () => ({ mode: "local" }),
    info: {
      chat_price: "2000000000000000000000",
      save_price: "50000000000000000000000",
      model: "m",
    },
    webOrigins: ["http://localhost:3000", "http://localhost:3001"],
    homeContractId: "kats.near",
    limits,
    trustProxy,
    sealing: keys.sealing(),
  });
  chain.mint("1", "alice.near", NEAR);
  await kats.wakeNew();

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
  return { app, chain, inference, signIn, as };
}

describe("keeper HTTP API", () => {
  test("serves the attestation without a session", async () => {
    const { app } = await setup();
    const response = await app.request("/attestation");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: "local" });
  });

  test("publishes its prices and model without a session", async () => {
    const { app } = await setup();
    const response = await app.request("/info");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      chat_price: "2000000000000000000000",
      save_price: "50000000000000000000000",
      model: "m",
    });
  });

  test("rejects a sign-in whose callback URL is not a string", async () => {
    const { app } = await setup();
    const { nonce } = await (await app.request("/auth/challenge", { method: "POST" })).json();
    const response = await app.request("/auth/session", {
      method: "POST",
      body: JSON.stringify({
        nonce,
        callback_url: 5,
        signed_message: { accountId: "alice.near", publicKey: "ed25519:pk", signature: "valid" },
      }),
    });
    expect(response.status).toBe(400);
  });

  test("lets a signed-in owner read and chat with their kat, but not rewrite it", async () => {
    const { app, signIn, as } = await setup();
    const token = await signIn("alice.near");

    const context = await app.request("/kats/1/context", as(token, undefined, "GET"));
    expect(await context.json()).toMatchObject({
      personality: STARTER_PERSONALITY,
      memory_summary: "",
      version: 1,
    });

    // A kat's character grows from conversation; there is no route to write it.
    const written = await app.request(
      "/kats/1/personality",
      as(token, { prompt: "grumpy" }, "PUT"),
    );
    expect(written.status).toBe(404);

    const chat = await app.request("/kats/1/chat", as(token, { message: "hello" }));
    expect(chat.status).toBe(200);
    expect(await chat.json()).toMatchObject({
      reply: "reply 1",
      verification: { chat_id: "chat-1" },
    });
  });

  test.each([
    ["no token", {}],
    ["a made-up token", { authorization: "Bearer nope" }],
    ["a token without the Bearer scheme", { authorization: "nope" }],
  ])("answers 401 to a kat request with %s", async (_name, headers) => {
    const { app } = await setup();
    const response = await app.request("/kats/1/context", { headers });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "unauthorized" });
  });

  test("rejects a sign-in whose signature does not verify", async () => {
    const { app } = await setup();
    const { nonce } = await (await app.request("/auth/challenge", { method: "POST" })).json();
    const response = await app.request("/auth/session", {
      method: "POST",
      body: JSON.stringify({
        nonce,
        signed_message: { accountId: "alice.near", publicKey: "ed25519:pk", signature: "forged" },
      }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "invalid_signature" });
  });

  test.each([
    ["no body", undefined],
    ["a body that is not JSON", "{"],
    ["a JSON array", "[]"],
    ["no signed message", JSON.stringify({ nonce: "abc" })],
    ["a signed message with no account", JSON.stringify({ nonce: "abc", signed_message: {} })],
  ])("answers 400 to a sign-in with %s", async (_name, body) => {
    const { app } = await setup();
    const response = await app.request("/auth/session", { method: "POST", body });
    expect(response.status).toBe(400);
  });

  test("answers 413 to a request body larger than 16 KB", async () => {
    const { app } = await setup();
    const response = await app.request("/auth/session", {
      method: "POST",
      body: JSON.stringify({ nonce: "x".repeat(20_000) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "too_large" });
  });

  test("answers unknown routes in the same JSON shape", async () => {
    const { app } = await setup();
    const response = await app.request("/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "not_found" });
  });

  test("answers 403 when a signed-in account does not own the kat", async () => {
    const { app, signIn, as } = await setup();
    const response = await app.request(
      "/kats/1/context",
      as(await signIn("bob.near"), undefined, "GET"),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "not_owner" });
  });

  test("answers 402 with the balance when the kat cannot pay", async () => {
    const { app, chain, signIn, as } = await setup();
    (chain.kats.get("1") as { balance: string }).balance = "5";
    const response = await app.request(
      "/kats/1/chat",
      as(await signIn("alice.near"), { message: "hello" }),
    );
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      error: "insufficient_balance",
      balance: "5",
      required: "2000000000000000000000",
    });
  });

  test("answers 503 when the model is down", async () => {
    const { app, inference, signIn, as } = await setup();
    inference.down = true;
    const response = await app.request(
      "/kats/1/chat",
      as(await signIn("alice.near"), { message: "hello" }),
    );
    expect(response.status).toBe(503);
  });

  test("answers 500 'corrupted' when the stored context fails its hash check", async () => {
    const { app, chain, signIn, as } = await setup();
    (chain.kats.get("1") as { context_hash: string }).context_hash =
      Buffer.alloc(32).toString("base64");
    const response = await app.request(
      "/kats/1/chat",
      as(await signIn("alice.near"), { message: "hello" }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "corrupted" });
  });

  test.each([
    ["a missing message", {}],
    ["a message that is a number", { message: 5 }],
  ])("answers 400 to a chat with %s", async (_name, body) => {
    const { app, signIn, as } = await setup();
    const response = await app.request("/kats/1/chat", as(await signIn("alice.near"), body));
    expect(response.status).toBe(400);
  });

  test("allows the web app's origin and no other", async () => {
    const { app } = await setup();
    const allowed = await app.request("/attestation", {
      headers: { origin: "http://localhost:3000" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const second = await app.request("/attestation", {
      headers: { origin: "http://localhost:3001" },
    });
    expect(second.headers.get("access-control-allow-origin")).toBe("http://localhost:3001");
    const other = await app.request("/attestation", {
      headers: { origin: "https://evil.example" },
    });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("export and limits", () => {
  test("lets the owner download their token's mind with its on-chain record", async () => {
    const { app, signIn, as } = await setup();
    const token = await signIn("alice.near");
    const response = await app.request("/kats/1/export", as(token, undefined, "GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("mind-1.json");
    expect(await response.json()).toMatchObject({
      format: "nearkat-mind/1",
      collection: "kats.near",
      token_id: "1",
      context: { personality: STARTER_PERSONALITY },
      record: { version: 1, key_epoch: 1 },
    });
    const mallory = await signIn("mallory.near");
    expect((await app.request("/kats/1/export", as(mallory, undefined, "GET"))).status).toBe(403);
  });

  test("slows down an account that sends messages too fast", async () => {
    const { app, signIn, as } = await setup({
      chat: new RateLimiter({ burst: 2, refillMs: 60_000 }),
      auth: new RateLimiter({ burst: 100, refillMs: 1 }),
    });
    const token = await signIn("alice.near");
    for (const message of ["one", "two"]) {
      expect((await app.request("/kats/1/chat", as(token, { message }))).status).toBe(200);
    }
    const third = await app.request("/kats/1/chat", as(token, { message: "three" }));
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: "rate_limited" });
  });

  test("slows down sign-in requests from one client", async () => {
    const { app } = await setup({
      chat: new RateLimiter({ burst: 100, refillMs: 1 }),
      auth: new RateLimiter({ burst: 2, refillMs: 60_000 }),
    });
    const challenge = () =>
      app.request("/auth/challenge", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      });
    expect((await challenge()).status).toBe(200);
    // A preflight costs nothing.
    await app.request("/auth/challenge", {
      method: "OPTIONS",
      headers: { origin: "http://localhost:3000", "access-control-request-method": "POST" },
    });
    expect((await challenge()).status).toBe(200);
    const refused = await challenge();
    expect(refused.status).toBe(429);
    // The browser can read the refusal: it carries the CORS headers.
    expect(refused.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  test("behind a proxy, tells clients apart by the address the proxy added, not what they sent", async () => {
    const { app } = await setup(
      {
        chat: new RateLimiter({ burst: 100, refillMs: 1 }),
        auth: new RateLimiter({ burst: 1, refillMs: 60_000 }),
      },
      true,
    );
    const from = (forwarded: string) =>
      app.request("/auth/challenge", {
        method: "POST",
        headers: { "x-forwarded-for": forwarded },
      });
    expect((await from("1.1.1.1, 203.0.113.9")).status).toBe(200);
    // A made-up first entry doesn't buy a new bucket.
    expect((await from("2.2.2.2, 203.0.113.9")).status).toBe(429);
    expect((await from("203.0.113.10")).status).toBe(200);
  });

  test("limits how often an account reads minds", async () => {
    const { app, signIn, as } = await setup({
      chat: new RateLimiter({ burst: 100, refillMs: 1 }),
      read: new RateLimiter({ burst: 1, refillMs: 60_000 }),
      auth: new RateLimiter({ burst: 100, refillMs: 1 }),
    });
    const token = await signIn("alice.near");
    expect((await app.request("/kats/1/context", as(token, undefined, "GET"))).status).toBe(200);
    expect((await app.request("/kats/1/export", as(token, undefined, "GET"))).status).toBe(429);
  });
});

describe("collections served alongside the home one", () => {
  async function setupMany() {
    const home = await setup();
    const chain = new FakeChain();
    chain.contractId = "tutor.near";
    chain.collection = {
      ...FAKE_COLLECTION,
      name: "Magister",
      prompt: "You are {name} #{token_id}, a tutor.",
      starter: "No student yet.",
    };
    const tutor = new KatService({
      chain,
      store: new MemoryStore(),
      keyring: keyringFor(chain),
      inference: home.inference,
      meter: new Meter(chain),
      prices: { chat: 2n * 10n ** 21n, save: 5n * 10n ** 22n },
      collection: chain.collection,
      retryDelayMs: 0,
    });
    chain.mint("1", "alice.near", NEAR);
    await tutor.wakeNew();
    const auth = new Auth({
      sessionKey: keys.sessionKey(),
      recipient: "nearkat.xyz",
      verify: async (signed) => signed.signature === "valid",
    });
    const app = createApp({
      auth,
      homeContractId: "nearkat.near",
      collection: (id) => (id === "tutor.near" ? tutor : undefined),
      collections: () => ({ served: ["tutor.near"] }),
      attestation: async () => ({ mode: "local" }),
      info: { chat_price: "1", save_price: "1", model: "m" },
      webOrigins: [],
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
    return { app, signIn, as: home.as };
  }

  test("reads and talks to a token of another collection under /c/:contract", async () => {
    const { app, signIn, as } = await setupMany();
    const token = await signIn("alice.near");
    const context = await app.request("/c/tutor.near/kats/1/context", as(token, undefined, "GET"));
    expect(await context.json()).toMatchObject({ personality: "No student yet." });
    const chat = await app.request("/c/tutor.near/kats/1/chat", as(token, { message: "salve" }));
    expect(chat.status).toBe(200);
  });

  test("says which collections it doesn't serve", async () => {
    const { app, signIn, as } = await setupMany();
    const token = await signIn("alice.near");
    const response = await app.request(
      "/c/unknown.near/kats/1/context",
      as(token, undefined, "GET"),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "not_served" });
  });

  test("asks for a session on scoped routes too", async () => {
    const { app } = await setupMany();
    const response = await app.request("/c/tutor.near/kats/1/context");
    expect(response.status).toBe(401);
  });

  test("says it is starting up while the home collection isn't served yet", async () => {
    const { app, signIn, as } = await setupMany();
    const token = await signIn("alice.near");
    const response = await app.request("/kats/1/context", as(token, undefined, "GET"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "waking_up" });
  });

  test("lists what it serves", async () => {
    const { app } = await setupMany();
    expect(await (await app.request("/collections")).json()).toEqual({ served: ["tutor.near"] });
  });
});

describe("art", () => {
  test("serves a token's picture as SVG to anyone", async () => {
    const auth = new Auth({
      sessionKey: keys.sessionKey(),
      recipient: "x",
      verify: async () => true,
    });
    const app = createApp({
      auth,
      art: async (contract, token) =>
        contract === "tutor.near" && token === "1" ? "<svg>tutor 1</svg>" : null,
      attestation: async () => ({ mode: "local" }),
      info: { chat_price: "1", save_price: "1", model: "m" },
      webOrigins: ["http://localhost:3000"],
    });
    const response = await app.request("/art/tutor.near/1.svg", {
      headers: { origin: "https://marketplace.example" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.text()).toBe("<svg>tutor 1</svg>");

    expect((await app.request("/art/tutor.near/2.svg")).status).toBe(404);
    expect((await app.request("/art/tutor.near/1.png")).status).toBe(404);
    // Only the art is open to every origin.
    const info = await app.request("/info", { headers: { origin: "https://marketplace.example" } });
    expect(info.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("importing a chat history", () => {
  const seal = (history: unknown, info = IMPORT_INFO) =>
    sealTo(keys.sealing().publicKeyHex, JSON.stringify(history), info);

  test("folds a sealed history into the token's memory, a save per part", async () => {
    const { app, inference, signIn, as } = await setup();
    const token = await signIn("alice.near");
    inference.evolveTo = {
      character: "You are curious.",
      memory: "Loves sci-fi and trail running.",
    };
    const messages = ["what are good hard sci-fi novels?", "plan a 10k trail run for me"];
    const response = await app.request(
      "/kats/1/import",
      as(token, { sealed: seal({ source: "chatgpt", messages }) }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ imported: 2, chunks: 1, version: 2 });
    const prompt = inference.calls.at(-1)?.[1]?.content ?? "";
    expect(prompt).toContain("Messages the owner wrote to ChatGPT:");
    expect(prompt).toContain("plan a 10k trail run for me");
    const context = await (
      await app.request("/kats/1/context", as(token, undefined, "GET"))
    ).json();
    expect(context.memory_summary).toBe("Loves sci-fi and trail running.");
    expect(context.personality).toBe("You are curious.");
  });

  test("reads a long history in parts, and charges for each", async () => {
    const { app, inference, signIn, as } = await setup();
    const token = await signIn("alice.near");
    const messages = Array.from({ length: 50 }, (_, i) => `${i} ${"x".repeat(1000)}`);
    const response = await app.request(
      "/kats/1/import",
      as(token, { sealed: seal({ source: "claude", messages }) }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).chunks).toBe(3);
    expect(inference.calls).toHaveLength(3);
    expect(inference.calls[0]?.[1]?.content).toContain("Messages the owner wrote to Claude:");
  });

  test("refuses a history that isn't sealed to this keeper for import", async () => {
    const { app, signIn, as } = await setup();
    const token = await signIn("alice.near");
    const history = { source: "chatgpt", messages: ["hi there"] };
    for (const sealed of [
      JSON.stringify(history),
      // Sealed to the right key, but as a secret prompt: a different purpose.
      seal(history, "nearkat-sealed-prompt:v1"),
      sealTo(
        keysFromRootSecret(Buffer.alloc(32, 9)).sealing().publicKeyHex,
        JSON.stringify(history),
        IMPORT_INFO,
      ),
    ]) {
      const response = await app.request("/kats/1/import", as(token, { sealed }));
      expect(response.status).toBe(400);
    }
  });

  test("takes a body far larger than other requests, but not an unlimited one", async () => {
    const { app, signIn, as } = await setup();
    const token = await signIn("alice.near");
    const fits = Array.from({ length: 100 }, () => "y".repeat(1000));
    const ok = await app.request(
      "/kats/1/import",
      as(token, { sealed: seal({ source: "chatgpt", messages: fits }) }),
    );
    expect(ok.status).toBe(200);
    const tooMuch = Array.from({ length: 130 }, () => "y".repeat(1000));
    const refused = await app.request(
      "/kats/1/import",
      as(token, { sealed: seal({ source: "chatgpt", messages: tooMuch }) }),
    );
    expect(refused.status).toBe(400);
    const huge = await app.request("/kats/1/import", as(token, { sealed: "z".repeat(900 * 1024) }));
    expect(huge.status).toBe(413);
  });

  test("is refused in a collection whose creator didn't allow it", async () => {
    const { app, signIn, as } = await setup(undefined, false, false);
    const token = await signIn("alice.near");
    const response = await app.request(
      "/kats/1/import",
      as(token, { sealed: seal({ source: "chatgpt", messages: ["hello there"] }) }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("import_off");
  });

  test("lets only the owner import, and only with the NEAR to pay for it", async () => {
    const { app, chain, signIn, as } = await setup();
    const sealed = seal({ source: "chatgpt", messages: ["hello"] });
    const bob = await signIn("bob.near");
    expect((await app.request("/kats/1/import", as(bob, { sealed }))).status).toBe(403);
    const alice = await signIn("alice.near");
    (chain.kats.get("1") as { balance: string }).balance = (10n ** 21n).toString();
    const poor = await app.request("/kats/1/import", as(alice, { sealed }));
    expect(poor.status).toBe(402);
  });
});

describe("dataset collections", () => {
  async function datasetSetup() {
    const base = await setup();
    const chain = new FakeChain();
    chain.collection = {
      ...FAKE_COLLECTION,
      kind: { Dataset: { classes: ["cat"] } },
      minted: 1,
      max_supply: 1,
    };
    chain.samples.set("1", {
      owner_id: "admin.near",
      sample_hash: null,
      sample_ref: null,
      runs: 0,
    });
    const kats = new KatService({
      collection: DEFAULT_COLLECTION,
      chain,
      store: new MemoryStore(),
      keyring: keyringFor(chain),
      inference: new FakeInference(),
      meter: new Meter(chain),
      prices: { chat: 1n, save: 1n },
      retryDelayMs: 0,
    });
    const ingest = new Ingest({
      contractId: chain.contractId,
      chain,
      store: new MemoryStore(),
      sealing: keys.sealing(),
      keySource: KEY_SOURCE,
      mpcPublicKey: () => chain.mpcPublicKey(KEY_SOURCE),
    });
    const auth = new Auth({
      sessionKey: keys.sessionKey(),
      recipient: "nearkat.xyz",
      verify: async (signed) => signed.signature === "valid",
    });
    const app = createApp({
      auth,
      attestation: async () => ({}),
      info: { chat_price: "1", save_price: "1", model: "m" },
      webOrigins: ["http://localhost:3000"],
      collection: (id) => (id === "set.near" ? kats : undefined),
      isDataset: (id) => id === "set.near",
      ingest: (id) => (id === "set.near" ? ingest : undefined),
    });
    return { app, chain, signIn: base.signIn, as: base.as };
  }
  // Sessions are signed with the same keys, so one sign-in works against either app.
  const sealedSample = (label: string) =>
    sealTo(
      keys.sealing().publicKeyHex,
      JSON.stringify({ label, jpeg: Buffer.from([0xff, 0xd8, 1]).toString("base64") }),
      SAMPLE_INFO,
    );

  test("dataset collections refuse chat", async () => {
    const { app, signIn, as } = await datasetSetup();
    const token = await signIn("alice.near");
    for (const [path, method] of [
      ["/c/set.near/kats/1/chat", "POST"],
      ["/c/set.near/kats/1/context", "GET"],
      ["/c/set.near/kats/1/export", "GET"],
      ["/c/set.near/kats/1/import", "POST"],
    ] as const) {
      const response = await app.request(
        path,
        as(token, method === "POST" ? { message: "hi" } : undefined, method),
      );
      expect(response.status).toBe(409);
      expect((await response.json()).message).toBe("Samples can't be talked to");
    }
  });

  test("seals samples for the creator only", async () => {
    const { app, chain, signIn, as } = await datasetSetup();
    const body = { samples: [{ token_id: "1", sealed: sealedSample("cat") }] };
    const mallory = await signIn("mallory.near");
    expect((await app.request("/c/set.near/samples", as(mallory, body))).status).toBe(403);
    const admin = await signIn("admin.near");
    const bad = await app.request(
      "/c/set.near/samples",
      as(admin, { samples: [{ token_id: "1", sealed: sealedSample("bird") }] }),
    );
    expect(bad.status).toBe(400);
    const ok = await app.request("/c/set.near/samples", as(admin, body));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ sealed: ["1"], skipped: [] });
    expect(chain.samples.get("1")?.sample_ref).toBeTruthy();
    const huge = await app.request(
      "/c/set.near/samples",
      as(admin, { samples: "z".repeat(5 * 1024 * 1024) }),
    );
    expect(huge.status).toBe(413);
  });

  test("refuses samples for a collection that isn't a dataset", async () => {
    const { app, signIn, as } = await datasetSetup();
    const token = await signIn("admin.near");
    expect((await app.request("/c/other.near/samples", as(token, { samples: [] }))).status).toBe(
      404,
    );
    expect((await app.request("/c/set.near/samples", { method: "POST", body: "{}" })).status).toBe(
      401,
    );
  });
});
